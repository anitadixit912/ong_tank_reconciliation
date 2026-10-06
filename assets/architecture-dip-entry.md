# Hydrocarbon Tank Management Solution
## Dip Reading Management Module — Architecture & Design

**Project:** Autonomous Tank Reconciliation System on SAP BTP  
**Platform:** SAP Business Technology Platform — Cloud Foundry  
**Source System:** SAP IS-Oil & Gas (OGS/650, S/4HANA Private Cloud)  
**Prepared for:** Stakeholder Review

---

## 1. What Problem Are We Solving?

Before this solution, the tank management process looked like this:

```
Operator measures tank with dip tape
        ↓
Manually enters reading into SAP T-Code
        ↓
Someone else runs a reconciliation in SAP
        ↓
Spreadsheet comparison vs. book stock
        ↓
Manual approval and goods movement posting
        ↓
Email distribution of results
```

**Problems:** Fragmented, slow, error-prone, no audit trail, no AI insight.

**With this solution:**

```
Operator or AI Agent enters dip reading (any method)
        ↓
System posts it to SAP IS-Oil automatically
        ↓
Reconciliation runs autonomously
        ↓
GREEN results auto-post, RED requires supervisor approval (one click)
        ↓
Report distributed automatically
```

---

## 2. The Full End-to-End Flow

```
═══════════════════════════════════════════════════════════════════════════════
                   HYDROCARBON TANK MANAGEMENT — FULL PIPELINE
═══════════════════════════════════════════════════════════════════════════════

 [STEP 1: CREATE DIP READING]
 ┌────────────────────────────────────────────────────────────────────────┐
 │  Method A — Manual Entry                                               │
 │  Operator selects tank → fills form → clicks "Save & Post to SAP"      │
 │                                                                        │
 │  Method B — Excel Upload                                               │
 │  Operator drags .xlsx file → system validates rows → batch posts       │
 │  (supports BAPI_SILO.xlsx and Tank Dip Posting Template_New.xlsx)      │
 │                                                                        │
 │  Method C — AI Natural Language                                        │
 │  Operator types: "Tank 23, 1842mm innage, 38.5°C, post-discharge"      │
 │  AI (Claude via SAP AI Core) extracts structured fields                │
 │  Operator reviews → confirms → posts                                   │
 │                                                                        │
 │  Method D — AI Agent (fully autonomous)                                │
 │  Supervisor tells the agent: "Create a dip reading for tank 23..."     │
 │  Agent executes the full pipeline without any manual steps             │
 └────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 [STEP 2: POST TO SAP IS-OIL]
 ┌────────────────────────────────────────────────────────────────────────┐
 │  CAP backend calls OGS_S4 BTP Destination                              │
 │  → Cloud Connector APAC_DEV10                                          │
 │  → SAP IS-Oil at http://10.236.250.15:8001                             │
 │  → ZTANK_DIP_SRV_SRV / TankDipSet (CREATE)                            │
 │  → Writes to OIB_TANKDIP table in IS-Oil                               │
 │  → Record status: DRAFT → SUBMITTED → POSTED                           │
 └────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 [STEP 3: STOCK RECONCILIATION]
 ┌────────────────────────────────────────────────────────────────────────┐
 │  M1 Data Collection: Reads live dip from ZTANK_DIP_SRV_SRV            │
 │  M2 VCF Correction: Gross → Net volume (ASTM D1250)                   │
 │  M3 Variance: (Physical − Book) / Book × 100%                         │
 │     GREEN  ≤ 0.5%    → auto-post                                       │
 │     AMBER  0.5–2%    → auto-post after 8 hours                         │
 │     RED    > 2%      → supervisor approval required                    │
 │  M4 Approval Gate: RED tanks wait in Approval Queue                    │
 │  M5 Goods Movement: Posts PI document to S/4HANA                      │
 │     (551 = Shrinkage / 552 = Gain)                                     │
 │  M6 Report: Teams webhook + BTP Alert Notification Service             │
 └────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 [STEP 4: SUPERVISOR APPROVAL (RED tanks only)]
 ┌────────────────────────────────────────────────────────────────────────┐
 │  Approval Queue page shows pending RED variances                       │
 │  Supervisor reviews delta, selects reason code, approves/rejects       │
 │  → Approved: Goods movement posts to S/4HANA                          │
 │  → Rejected: Run flagged, audit trail updated                          │
 └────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
```

---

## 3. System Components

### 3a. The Dashboard (React Web Application)

A browser-based application accessible via SAP BTP at:  
`https://tank-reconciliation-approuter-proud-jackal-qo.cfapps.us10.hana.ondemand.com`

**Pages in the sidebar:**

| Page | Who Uses It | What It Does |
|---|---|---|
| 🏠 Dashboard | Everyone | Trigger runs, view results (GREEN/AMBER/RED), tank details |
| ✅ Approval Queue | Supervisors only | Review and approve/reject RED variance postings |
| 📋 Audit Trail | Everyone | Complete history of every action taken |
| 📈 Variance Trends | Everyone | 30-day delta trend charts per tank |
| 💧 **Dip Entry** *(NEW)* | **Everyone** | **Create dip readings (Manual / Excel / AI)** |
| ⚙️ Configuration | Admins only | Configure tank thresholds and settings |
| 💬 AI Assistant | Everyone | Natural language Q&A on tank data |
| 🚢 TSW Nomination Agent | Everyone | Vessel nomination ETA intelligence |

---

### 3b. The CAP Backend (Central API)

SAP Cloud Application Programming model on BTP CF.  
Deployed at: `https://tank-reconciliation-cap-srv-patient-leopard-kw.cfapps.us10.hana.ondemand.com`

This is the **brain of the system** — it:
- Stores all data (reconciliation runs, tank results, dip readings, approvals, audit logs)
- Proxies all S/4HANA calls via BTP Destination Service (never exposes credentials to the browser)
- Runs the M1-M6 reconciliation pipeline
- Calls SAP AI Core for natural language extraction

**New actions added for Dip Entry:**

| Action | What It Does |
|---|---|
| `saveDipReading` | Saves a new dip reading in the database (status: DRAFT) |
| `saveDipToSAP` | Posts a saved dip reading to SAP IS-Oil via OGS_S4 |
| `batchSaveDipsToSAP` | Posts multiple dip readings in one call (for Excel uploads) |
| `parseDipFromPrompt` | Calls SAP AI Core (Claude) to extract dip fields from natural language text |

---

### 3c. SAP IS-Oil Integration (via OGS_S4 Destination)

All reads and writes to SAP IS-Oil go through the **OGS_S4 BTP Destination**, never direct.

```
BTP CAP App
    │
    ├─→ BTP Destination Service
    │       resolves OGS_S4 → URL + credentials
    │
    ├─→ BTP Connectivity Service (Cloud Connector)
    │       proxies through APAC_DEV10 → on-premise network
    │
    └─→ SAP IS-Oil at http://10.236.250.15:8001
            ├─ ZTANK_DIP_SRV_SRV   (read dips, CREATE dip — if enabled)
            ├─ ZTANK_POST_SRV_SRV  (post goods movements)
            └─ ZTANK_PLANT_SRV_SRV (plant/terminal list)
```

**ABAP Note:** The CREATE operation on `ZTANK_DIP_SRV_SRV/TankDipSet` may not yet be exposed. If it returns HTTP 405, the system saves the reading with status `PENDING_ABAP` — no data is lost. The OGS/ABAP team needs to expose `BAPI_TANK_DIP` (function group `OI0_BAPI`) via a writable OData service entity.

---

### 3d. AI Assistant (SAP AI Core — `aicore` destination)

Used in two places:
1. **AI Chat page** — operators ask questions like "What was tank 23's variance last Tuesday?"
2. **Dip Entry AI Prompt tab** — operators describe a reading in plain English; AI extracts all structured fields

Model: Claude (via SAP AI Core deployment on `aicore` BTP Destination).  
**No hallucinations:** AI extracts only what the user said. If a field is missing from the text, it returns null — never invents data.

---

### 3e. Tank Dip MCP Server (NEW — `assets/tank-dip-mcp-server`)

An MCP (Model Context Protocol) server deployed separately on CF.  
It exposes the dip management operations as **tools that AI Agents can call**.

```
┌─────────────────────────────────┐
│    Tank Dip MCP Server          │
│    (CF app: tank-dip-mcp-server)│
│                                 │
│  Tools:                         │
│  • get_tank_configurations      │
│  • get_tank_dips                │
│  • list_dip_readings            │
│  • create_dip_reading           │
│  • post_dip_to_sap              │
│  • batch_post_dips_to_sap       │
│  • trigger_reconciliation_run   │
│  • get_reason_codes             │
└─────────────────────────────────┘
         ↑ agents call this
```

This follows the same pattern as the existing `nomination-mcp-server` which serves the TSW Nomination ETA Agent.

---

### 3f. Tank Reconciliation AI Agent (enhanced)

The existing Python/LangGraph agent (`assets/tank-reconciliation-agent`) now has 5 new tools:

| New Tool | What It Enables |
|---|---|
| `get_tank_configurations` | Agent can look up tank SOCNR IDs |
| `create_dip_reading` | Agent creates dip records autonomously |
| `post_dip_to_sap` | Agent posts dip to IS-Oil |
| `list_dip_readings` | Agent reads historical dips |
| `trigger_reconciliation_run` | Agent runs the full reconciliation |

**Example autonomous conversation:**
> User: "Create today's dip reading for tank 23 — 1842mm innage, 38.5°C, density 850 kg/m³, post-discharge event"
>
> Agent: ✅ Dip reading created (ID: a1b2c3...). ✅ Posted to SAP IS-Oil. ✅ Reconciliation run triggered for 2026-10-06 plant 1743. Result: GREEN variance 0.3%. No approval required.

---

## 4. Data Model — DipReading Entity

Each dip reading goes through this lifecycle:

```
DRAFT → SUBMITTED → POSTED
                  ↘ FAILED
                  ↘ PENDING_ABAP
```

| Field | Description | Example |
|---|---|---|
| `tankId` | 20-char SOCNR (zero-padded) | `00000000000000000023` |
| `measurementDate` | Date of physical measurement | `2026-10-06` |
| `measurementTime` | Time in HHMMSS | `143000` (= 14:30) |
| `dipType` | I = Innage (depth), U = Ullage (empty space) | `I` |
| `dipValue` | Physical measurement number | `1842.500` |
| `dipUnit` | Unit of measure | `MM`, `CM`, `M3`, `BBL` |
| `waterHeight` | Free water level (optional) | `45.000` |
| `temperature` | Celsius — for VCF/ASTM correction | `38.5` |
| `density` | kg/m³ — for VCF/ASTM correction | `850.0` |
| `dipEvent` | Short event label | `Post-discharge` |
| `inputMethod` | How it was created | `MANUAL`, `EXCEL`, `AI_PROMPT` |
| `postingStatus` | Current state | `DRAFT` / `POSTED` / `FAILED` |
| `bapiResponse` | Response from SAP IS-Oil | `DIP_CREATED_OK` |

---

## 5. Deployment Summary

All components run on **SAP BTP Cloud Foundry** (never Kyma/Kubernetes):

| CF App Name | Type | Purpose |
|---|---|---|
| `tank-reconciliation-approuter` | App Router | Authentication + UI hosting |
| `tank-reconciliation-cap-srv` | CAP Node.js | Backend API + S/4HANA proxy |
| `tank-reconciliation-agent` | Python / LangGraph | AI reconciliation agent |
| `nomination-mcp-server` | Python / MCP | Nomination tools for ETA agent |
| `nomination-eta-agent` | Python / LangGraph | TSW vessel ETA intelligence |
| `tank-dip-mcp-server` | Python / MCP | **NEW** — dip management tools |

**CF Space:** `gdh-prj-vector-hackathon-apac-dev10-4dixnr9o / Dev`  
**CF API:** `https://api.cf.us10.hana.ondemand.com`

---

## 6. What Is NOT Yet Complete (ABAP Dependency)

| Item | Owner | Impact |
|---|---|---|
| CREATE support on `ZTANK_DIP_SRV_SRV/TankDipSet` | OGS ABAP Team | Until done, dip readings are stored in CAP with `PENDING_ABAP` status — no data loss, can be re-submitted |
| Alternatively: new `ZTANK_DIPINPUT_SRV_SRV` wrapping `BAPI_TANK_DIP` (fn group `OI0_BAPI`) | OGS ABAP Team | Required for full end-to-end IS-Oil write |

Everything else (UI, CAP backend, agent, MCP server) is fully implemented and deployable now.

---

## 7. Security Notes

- All SAP IS-Oil calls go through the **BTP Destination Service** — no credentials are exposed to the browser or agents
- Authentication via **XSUAA** — roles: `ReconciliationUser`, `ReconciliationApprover`, `ReconciliationAdmin`, `OGSIntegration`
- All AI calls use the **`aicore` BTP Destination** — only the CAP backend has credentials
- Supervisors see Approval Queue only; Admins see Configuration only
