# Hydrocarbon Tank Stock Reconciliation — Solution Narrative

---

## The Business Problem

Hydrocarbon terminals handle thousands of tonnes of high-value products — crude oil, diesel, propane, gasoline — stored across multiple tanks. Every day, two critical questions must be answered:

> **"How much product is physically in the tank?"**
> **"How much does SAP say should be there?"**

The gap between these two numbers — the **reconciliation variance** — determines whether product has been lost, gained, or simply miscounted. Getting this wrong has serious consequences:

- **Financial loss** — undetected shrinkage means unrecorded inventory write-offs
- **Compliance risk** — hydrocarbon movements require accurate audit trails for regulatory reporting
- **Safety risk** — incorrect stock levels can lead to over-filling or dry-running tanks

### How it works today (the manual way)

1. A terminal operator physically measures the tank with a dip rod or reads the ATG (Automatic Tank Gauge) system
2. They write down the reading on paper or in a spreadsheet
3. Someone else logs into SAP and looks up the book stock for that material/plant
4. They manually calculate the difference using a calculator or Excel
5. They apply VCF (Volume Correction Factor) tables to adjust for temperature — another manual lookup
6. They classify the variance (OK / FLAG / URGENT) based on tolerance thresholds they remember from a policy document
7. If URGENT, they email a supervisor for approval
8. The supervisor replies by email — or doesn't, causing delays
9. Someone manually posts a goods movement in SAP MIGO
10. They update a shared spreadsheet or email a report to Finance and the terminal manager

**This process takes 2–4 hours per day, per terminal.** It is:
- **Error-prone** — manual calculations, wrong VCF table, wrong material number
- **Not auditable** — email chains and spreadsheets are not tamper-evident
- **Slow** — URGENT variances can sit unresolved for hours waiting for email approvals
- **Fragmented** — data lives in ATG systems, SAP, spreadsheets, and email simultaneously
- **Not scalable** — adding a new terminal means more manual work, not more automation

### The hidden complexity — IS-OIL

Standard SAP has no concept of a "tank" — it knows materials, plants, and storage locations. IS-OIL Downstream HPM (Hydrocarbon Product Management) extends SAP with tank master data, dip history, strapping calibration tables, and VCF conversion — but none of this is exposed via standard public OData APIs. Building a digital solution means reaching deep into IS-OIL-specific tables and function modules that most SAP developers have never seen.

---

## The Solution

We built a **fully automated, end-to-end tank stock reconciliation pipeline** on SAP BTP that eliminates every manual step — from reading the tank gauge to posting the material document in S/4HANA.

### What changed

| Before | After |
|--------|-------|
| Operator reads dip manually, writes on paper | IS-OIL `OIB_TANKDIP` read automatically via custom OData service |
| Book stock looked up manually in SAP | `RELSTOCK` fetched directly from IS-OIL dip record |
| VCF correction done with Excel/lookup tables | VCF Calculator applies automatically, ASTM fallback if API unavailable |
| Delta calculated in spreadsheet | Variance Engine computes delta and classifies in milliseconds |
| Supervisor approval via email | Approval Queue in CAP dashboard with full audit record |
| Goods movement posted manually in MIGO | Material Document created automatically via `API_MATERIAL_DOCUMENT_SRV` |
| Report emailed manually | PDF generated and distributed to Email + MS Teams automatically |
| No audit trail | Every milestone, decision, and posting recorded with timestamp and actor |

### Three layers working together

**Layer 1 — IS-OIL OGS/650 (the source of truth)**
All tank data lives here. We built two custom OData services in OGS:
- `ZTANK_DIP_SRV_SRV` — exposes live tank dip readings from `OIB_TANKDIP`
- `ZTANK_PLANT_SRV_SRV` — exposes plant/terminal list for the dashboard

We also built `Z_TANK_RECON_TRIGGER_RUN` — an ABAP function module that allows OGS itself to trigger reconciliation runs on BTP, enabling full IS-OIL-native scheduling.

**Layer 2 — BTP (the automation engine)**
Two components run on SAP BTP:
- **n8n workflow** — the orchestration engine that drives all 6 milestones, calls IS-OIL APIs, computes variances, holds URGENT postings, and distributes reports
- **CAP application** — the persistent backbone that stores all run history, variance records, approval decisions, and audit logs. It is also the approval state machine — URGENT tanks are held here until a supervisor acts

**Layer 3 — React Dashboard (the single cockpit)**
One unified interface for all roles:
- **Terminal Operator** — sees run status and tank results
- **Stock Controller** — monitors variances and drills into tank detail
- **Terminal Supervisor** — reviews and approves URGENT variances
- **Finance Accountant** — tracks postings and material document IDs
- **Compliance Officer** — reviews the full audit trail

### The key innovation

The hardest part was not the BTP side — it was **reaching into IS-OIL**. There are no public APIs for tank dip data. We had to:
- Discover the IS-OIL data model (`OIB_TANKDIP`, `OIISOCISL`, `OIIC_DIP_READ_TANKDIPS`)
- Build custom OData Gateway services in OGS/650
- Route requests through SAP Cloud Connector with the correct proxy headers
- Map plant/location to IS-OIL SOCNR identifiers

The result is the **first live IS-OIL to BTP integration** in this landscape — real tank dip data flowing from OGS/650 into a BTP reconciliation dashboard, verified against source records.

---

## The Flow — 6 Milestones

**M1 — Data Ingestion**
Every day at 6am (or on-demand from the dashboard), the system reads live tank dip measurements directly from the IS-OIL `OIB_TANKDIP` table in OGS/650 via the custom OData service `ZTANK_DIP_SRV_SRV`. Each dip record contains both the physical quantity (`QUAN_SKU`) and the corresponding book stock (`RELSTOCK`) at the time of measurement. If any configured tank is missing a dip reading, the run halts immediately and raises an URGENT alert.

**M2 — VCF Correction**
Raw observed volumes are converted to net standard volumes using Volume Correction Factors. The system calls the SAP Hydrocarbon Quantity Conversion REST API. If unavailable, it automatically falls back to ASTM D1250 tables stored in the CAP application — and flags this in the audit trail so operators know which tanks used the fallback.

**M3 — Variance Calculation**
Delta = Physical Quantity − Book Stock. Each tank is classified against configurable tolerance thresholds:
- **OK** — delta within tolerance (default 0.10%) — posts automatically
- **FLAG** — delta exceeds OK but within secondary threshold (default 0.25%) — posts automatically with notification
- **URGENT** — delta exceeds FLAG threshold — held for supervisor approval

**M4 — Approval Decision**
URGENT variances are held in the CAP approval queue. The Terminal Supervisor receives a real-time alert and reviews the tank detail in the dashboard. They either **Approve** (with optional comment) or **Reject** (with mandatory comment). No posting ever reaches the financial ledger without an explicit approval record — this is the key governance control.

**M5 — Goods Movement Posting**
OK and FLAG tanks post automatically. URGENT tanks post only after supervisor approval. A Material Document is created in S/4HANA using movement type 551 (shrinkage) or 552 (gain). The document number is written back to the CAP audit trail for full traceability — operators can look up the exact SAP document from the dashboard.

**M6 — Report & Alert Distribution**
A per-tank variance PDF is generated containing tank ID, gross/net volumes, VCF factors, book stock, delta, classification, and posting status. It is distributed to Email and MS Teams. Real-time OK/FLAG/URGENT alerts fire to Finance Accountants and Supervisors via SAP BTP Alert Notification Service. The audit trail is closed with all milestone outcomes recorded.

---

## Challenges We Faced

**1. IS-OIL is not a standard API world**
There are no public OData services for IS-OIL tank dip data. We had to discover the right ABAP function modules (`OIIC_DIP_READ_TANKDIPS`), identify the correct tables (`OIB_TANKDIP`, `OIISOCISL`), build custom Gateway services in OGS/650, and implement the `PLANTSSET_GET_ENTITYSET` method ourselves from scratch.

**2. SAP GUI on Mac — no ABAP editor**
Development on macOS hit a wall — `SE37`/`SE38` consistently crashed with `CNTL_ERROR` due to SAP GUI for Java incompatibilities. We worked around this by switching to the web-based SAP GUI and later used `SE16N` for data exploration and direct table verification.

**3. Cloud Connector proxy — not obvious**
Connecting BTP to on-premise OGS/650 through Cloud Connector required understanding the proxy protocol: the correct `Proxy-Authorization` header, `SAP-Connectivity-SCC-Location_ID` header, and routing requests through `connectivityproxy.internal.cf.us10.hana.ondemand.com:20003`. The error progression was `ECONNREFUSED` → `503` → `501` → `200` as we fixed each layer one by one.

**4. XSUAA tenant mode locked**
The XSUAA instance was created with `tenant-mode: shared` and could not be changed after deployment. This blocked the AppRouter from working correctly. We solved it by setting `TENANT_HOST_PATTERN` and `UAA_SERVICE_NAME` environment variables on the AppRouter to force the correct tenant resolution.

**5. OData filter case sensitivity in ABAP**
The `TANKDIPSET_GET_ENTITYSET` method was ignoring the `$filter` parameter because the property name comparison used `'Socnr'` but the actual OData property was `'SOCNR'`. A subtle but critical bug — all tanks were returning the same wrong dip record until we fixed the case sensitivity.

**6. IS-OIL data model discovery**
There is no documentation for which table links plant/location to SOCNR. We traced through `OIISOCISL`, `OIISOCK`, `OIB_TANKDIP`, and multiple function module parameters to discover that `OIISOCISL` is the correct mapping table — plant + location + tank name → SOCNR.

**7. OA2C_CONFIG not accessible from Mac**
Configuring OAuth in SM59 required `OA2C_CONFIG` which redirects to a browser-based UI that was unreachable from outside the network. We solved this by implementing Basic Auth + ABAP token fetch pattern instead — building `Z_TANK_RECON_TRIGGER_RUN` to handle the full OAuth client credentials flow from ABAP.

---

## Key Achievements

**✅ First live IS-OIL integration on BTP in this landscape**
Successfully connected SAP BTP to IS-OIL HPM tank data on a Private Cloud system via Cloud Connector — reading real `OIB_TANKDIP` data with correct physical quantities and book stock values verified against source records.

**✅ Custom OData services built from scratch**
Built `ZTANK_DIP_SRV_SRV` and `ZTANK_PLANT_SRV_SRV` in OGS/650 using SEGW — exposing IS-OIL tank data as OData for the first time in this landscape.

**✅ OGS → BTP machine-to-machine integration**
Implemented `Z_TANK_RECON_TRIGGER_RUN` ABAP function module in OGS/650 that fetches an XSUAA token and calls the BTP CAP endpoint — enabling IS-OIL systems to trigger reconciliation runs directly from ABAP.

**✅ Full approval governance on BTP**
URGENT variances are held in a CAP state machine — no material document is ever posted without supervisor sign-off recorded in the immutable audit trail.

**✅ Data accuracy verified end-to-end**
Dashboard values match `OIB_TANKDIP` source data exactly — book stock, physical quantity, and delta all verified against SE16N records in OGS/650.

**✅ Role-based access control**
Approval Queue visible only to Supervisors, Configuration only to Admins — enforced both at API level (XSUAA scopes) and UI level (React ProtectedRoute).

**✅ 2 minutes vs. 2–4 hours**
What used to take 2–4 hours of manual work per day now completes in under 2 minutes — with a full audit trail, governance controls, and real-time alerts.

---

## Architecture in One Sentence

> **n8n workflow** on BTP orchestrates the reconciliation pipeline → **CAP application** is the persistent backbone and approval state machine → **React dashboard** is the single cockpit for all roles → **IS-OIL OGS/650** is the source of truth for tank data → **Cloud Connector** bridges the on-premise IS-OIL world to BTP securely.

Architecture in One Sentence - Explain in simpler terms with diagrams please?                                                                                                                                                                

⏺ Let me create a simple visual explanation:
  
  ---
  Architecture — How the Pieces Connect

  ┌─────────────────────────────────────────────────────────────────┐
  │                     ON-PREMISE (OGS/650)                        │
  │                                                                  │
  │  🛢 Tank 1 (USMOB-17T1)    🛢 Tank 2 (USMOB-17T2)             │
  │       Diesel                    C3 Propane                      │
  │         │                           │                           │
  │         └──────────────┬────────────┘                           │
  │                        ▼                                        │
  │              📋 OIB_TANKDIP Table                               │
  │         (physical dip readings + book stock)                    │
  │                        │                                        │
  │         ┌──────────────▼──────────────┐                        │
  │         │   ZTANK_DIP_SRV_SRV         │                        │
  │         │   (Custom OData Service)    │                        │
  │         └──────────────┬──────────────┘                        │
  └────────────────────────┼────────────────────────────────────────┘
                           │ Cloud Connector (APAC_DEV10)
                           │ (secure tunnel through firewall)
                           │
  ┌────────────────────────▼────────────────────────────────────────┐
  │                        SAP BTP                                   │
  │                                                                  │
  │  ┌─────────────────┐         ┌──────────────────────────────┐  │
  │  │   n8n Workflow  │─────────▶│      CAP Application         │  │
  │  │                 │  reads/  │                              │  │
  │  │  1. Fetch dips  │  writes  │  • Stores run history        │  │
  │  │  2. VCF calc    │          │  • Stores tank results       │  │
  │  │  3. Variance    │          │  • Holds URGENT for approval │  │
  │  │  4. Post to S4  │          │  • Full audit trail          │  │
  │  │  5. Send report │          │                              │  │
  │  └─────────────────┘         └──────────────┬───────────────┘  │
  │                                              │                   │
  │                                             ▼                   │
  │                               ┌─────────────────────────┐      │
  │                               │   React Dashboard        │      │
  │                               │                          │      │
  │                               │  📊 Dashboard (all)      │      │
  │                               │  ✅ Approvals (super)    │      │
  │                               │  📋 Audit Trail (all)    │      │
  │                               │  ⚙️   Config (admin)      │      │
  │                               └─────────────────────────┘      │
  │                                                                  │
  │  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
  │  │ BTP Alert    │  │   Email     │  │   MS Teams          │   │
  │  │ Notification │  │   Report    │  │   Webhook           │   │
  │  └──────────────┘  └─────────────┘  └─────────────────────┘   │
  └──────────────────────────────────────────────────────────────────┘
                           │
                           │ posts Material Document
                           ▼
                📄 S/4HANA Material Document
                (551 = shrinkage / 552 = gain)

  ---
  In Plain English
  
  Think of it as 4 rooms connected by pipes:

    🏭 ROOM 1          🔗 CORRIDOR        ⚙️  ROOM 2           👁️  ROOM 3
    OGS/650             Cloud              BTP                 Dashboard
    (the tank)          Connector          (the brain)         (what you see)

    Real tank     ──── secure ────▶  n8n reads dips   ──▶  You see results
    dip data             tunnel        CAP stores them        approve/reject
    lives here                         alerts sent            audit trail

  ---
  Who does what
  
  ┌─────────────────┬──────────────────────────────────────┬───────────────────────────────┐
  │    Component    │                 Role                 │        Simple Analogy         │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ OGS/650         │ Where tank data lives                │ The filing cabinet            │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ Cloud Connector │ Secure bridge between OGS and BTP    │ The locked door between rooms │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ n8n             │ Does all the work automatically      │ The robot worker              │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ CAP             │ Remembers everything, enforces rules │ The manager                   │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ React Dashboard │ What people see and interact with    │ The office noticeboard        │
  ├─────────────────┼──────────────────────────────────────┼───────────────────────────────┤
  │ XSUAA           │ Checks who is allowed to do what     │ The security guard            │
  └─────────────────┴──────────────────────────────────────┴───────────────────────────────┘

  ---
  The data journey in 5 steps

  STEP 1          STEP 2           STEP 3          STEP 4         STEP 5
     │               │                │               │              │
     ▼               ▼                ▼               ▼              ▼
  Tank dip     Cloud Connector    n8n fetches      CAP stores    Dashboard
  in OGS  ──▶  passes it to  ──▶  dip, computes ──▶ result,  ──▶ shows result
  OIB_TANKDIP     BTP              variance         approvals     to user
                                   posts to S4      audit log


