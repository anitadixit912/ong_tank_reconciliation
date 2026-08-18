# Hydrocarbon Tank Stock Reconciliation

End-to-end automated tank stock reconciliation pipeline on SAP BTP, integrated with IS-OIL Downstream HPM on SAP S/4HANA Private Cloud (OGS/650).

## Live Demo

- **Dashboard (AppRouter):** `https://tank-reconciliation-approuter-proud-jackal-qo.cfapps.us10.hana.ondemand.com`
- **CAP API:** `https://tank-reconciliation-cap-srv-patient-leopard-kw.cfapps.us10.hana.ondemand.com`

## Prerequisites

- Node.js >= 20
- CF CLI installed and logged in to BTP
- Access to OGS/650 (S/4HANA Private Cloud with IS-OIL HPM)
- BTP subaccount with:
  - XSUAA service (`tank-reconciliation-xsuaa`)
  - Destination service (`tank-reconciliation-destination`)
  - Connectivity service (`proj-vector-connectivity-service`)

## Getting Started After Git Pull

### 1. Install Dependencies

```bash
cd assets/tank-reconciliation-cap
npm install

cd app/react-ui
npm install
cd ../..
```

### 2. Build for BTP Deployment

```bash
node build.js
```

This single command:
- Runs `cds build --production`
- Builds the React UI with Vite
- Copies built UI into `gen/srv/app/`
- Installs production dependencies in `gen/srv/`

### 3. Deploy to BTP

```bash
cf login
cf push tank-reconciliation-cap-srv -f manifest.yml
cf push tank-reconciliation-approuter -f manifest.yml
```

### 4. Set Environment Variables (one-time)

```bash
# Webhook notifications (Teams, Slack, or webhook.site for testing)
cf set-env tank-reconciliation-cap-srv TEAMS_WEBHOOK_URL "https://your-webhook-url"

# BTP Alert Notification Service (optional)
cf set-env tank-reconciliation-cap-srv BTP_ANS_URL "https://your-ans-url"
cf set-env tank-reconciliation-cap-srv BTP_ANS_TOKEN "your-ans-token"

# n8n workflow (optional - if deploying n8n separately)
cf set-env tank-reconciliation-cap-srv N8N_WEBHOOK_URL "https://your-n8n-url/webhook/tank-reconciliation/trigger"
cf set-env tank-reconciliation-cap-srv N8N_APPROVAL_CALLBACK_URL "https://your-n8n-url/webhook/tank-reconciliation/approval-callback"

cf restage tank-reconciliation-cap-srv
```

### 5. Open the App

```
https://tank-reconciliation-approuter-[random].cfapps.us10.hana.ondemand.com
```

---

## OGS/650 Components (Already Configured)

These are deployed in OGS/650 and do not need to be recreated:

| Component | Type | Purpose |
|-----------|------|---------|
| `ZTANK_DIP_SRV_SRV` | OData Service | Exposes live tank dip readings from `OIB_TANKDIP` |
| `ZTANK_PLANT_SRV_SRV` | OData Service | Exposes plant/terminal list |
| `ZTANK_POST_SRV_SRV` | OData Service | Goods movement posting via `OIIC_DIP_POST_MAIN` |
| `Z_TANK_RECON_TRIGGER_RUN` | ABAP FM | M2M integration — OGS triggers BTP run |
| `ZTANK_POST_TEST` | ABAP Report | Test program for posting |
| `ZCL_ZTANK_DIP_SRV_DPC_EXT` | ABAP Class | DPC extension for dip service |
| `ZCL_ZTANK_POST_SRV_DPC_EXT` | ABAP Class | DPC extension for posting service |

### BTP Destination Required

In BTP Cockpit → Connectivity → Destinations:

| Name | Type | URL | Proxy | Auth |
|------|------|-----|-------|------|
| `OGS_S4` | HTTP | `http://10.236.250.15:8001` | OnPremise | BasicAuthentication |

Cloud Connector Location ID: `APAC_DEV10`

---

## Architecture

```
OGS/650 (IS-OIL HPM)          SAP BTP                    Users
─────────────────────         ────────────────────────    ──────────────
OIB_TANKDIP                   CAP Application             React Dashboard
  ↓ ZTANK_DIP_SRV_SRV  ─────→  (persistent backbone)  ←→  All roles
ZTANK_PLANT_SRV_SRV            + Approval state machine
ZTANK_POST_SRV_SRV             + Audit trail
                               + OData APIs
                                    ↓
                               AppRouter (XSUAA auth)
                                    ↓
                               Webhook/Teams alerts (M6)
```

---

## End-to-End Workflow

1. **Trigger Run** — Dashboard → select date → ⚡ Trigger Run
   - Reads live dips from IS-OIL `OIB_TANKDIP` (RELSTOCK = physical, QUAN_SKU = book stock)
   - Computes delta per tank (Physical − Book Stock)
   - Classifies: 🟢 GREEN (≤0.5%) / 🟡 AMBER (0.5-2%) / 🔴 RED (>2%)

2. **Dashboard Updates** — New run in table, 🔔 notification bell updates

3. **Alert Sent (M6)** — Webhook notification fires with run summary

4. **Approval Queue (M4)** — Supervisor reviews URGENT tanks → Approve / Reject

5. **Posting Attempted (M5)** — Goods movement posting via `ZTANK_POST_SRV_SRV`

6. **Audit Trail** — Full M1→M6 history with timestamps and actors

---

## Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 — Data Ingestion | ✅ Complete | Live IS-OIL data from OIB_TANKDIP via ZTANK_DIP_SRV_SRV |
| M2 — VCF Correction | ✅ Complete | QUAN_SKU already VCF-corrected by IS-OIL — factor 1.0 correct |
| M3 — Variance Calculation | ✅ Complete | GREEN/AMBER/RED classification with AI recommendations in audit |
| M4 — Approval Decision | ✅ Complete | Dynamic reason codes from T157D, reason code mandatory for RED |
| M5 — Goods Movement Posting | ✅ Complete | PI BAPIs: CREATE → COUNT → POSTDIFF. Dip timestamp as count date. Material doc hyperlink to OGS. AI recommendation on failure. |
| M6 — Report & Alert Distribution | ✅ Complete | Teams webhook + BTP ANS + in-app bell. AMBER auto-post after 8 hours. |

---

## User Roles

| Role | Access |
|------|--------|
| Terminal Operator | Dashboard, Tank Detail, Audit Trail |
| Stock Controller | Dashboard, Tank Detail, Trends, Audit Trail |
| Terminal Supervisor | + Approval Queue |
| Administrator | + Configuration |
| OGS Integration | M2M via `Z_TANK_RECON_TRIGGER_RUN` ABAP FM |

---

## Local Development

```bash
# Start CAP server locally (SQLite in-memory, dummy auth)
cd assets/tank-reconciliation-cap
npm install
cds watch

# Start React UI dev server (separate terminal)
cd app/react-ui
npm run dev
# Opens at http://localhost:5173 (proxies /reconciliation to localhost:4004)
```

---

## n8n Workflow — New Joiner Guide

> If you are new to this project, read this section before looking at any code.

---

### What is n8n?

n8n is an **open-source workflow automation platform** — a visual pipeline builder where each node does one thing (call an API, run JavaScript, check a condition, wait for a callback). It runs on SAP BTP alongside the CAP application.

In this solution:

| Component | Role |
|-----------|------|
| **CAP application** | The brain — stores runs, variances, approvals, audit trail; serves the React dashboard |
| **n8n workflow** | The engine — orchestrates every automated step from data ingestion to goods movement posting |
| **AppRouter (jackal)** | The front door — the URL you open in a browser; serves the React UI |

---

### Workflow Pipeline — Visual Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TRIGGER (daily 06:00 or on-demand)              │
│              ⏰ Daily Scheduler  ──┐                                     │
│              🔗 Webhook Trigger  ──┴──→  Normalize Input                │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  M1  DATA INGESTION                                                      │
│                                                                          │
│   📡 ATG Ingest          📋 Fetch Tank Config                            │
│   (IS-OIL OData)         (CAP TankConfiguration)                        │
│         └──────────────────────┘                                        │
│                       │                                                  │
│              Merge & Validate Data                                       │
│                       │                                                  │
│              Completeness Check ──── ❌ Missing readings?               │
│                       │                      └──→ Halt + URGENT Alert   │
│                       ✅ All tanks present                               │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  M2  VCF CORRECTION  (Gross → Net Volume)                               │
│                                                                          │
│   📐 Read Measurement Docs (strapping data)                             │
│                       │                                                  │
│   🌡️  Call VCF Conversion API ──── ❌ API down?                         │
│                       │                  └──→ ASTM D1250 Fallback       │
│                       ✅ Net volumes calculated                          │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  M3  VARIANCE ENGINE                                                     │
│                                                                          │
│   delta  =  Physical Stock  −  Book Stock                               │
│   delta% =  delta / Book Stock × 100                                    │
│                                                                          │
│   Classification:                                                        │
│   🟢 GREEN   delta% ≤ 0.5%    → auto-post (no human action needed)     │
│   🟡 AMBER   delta% 0.5–2%   → auto-post + supervisor notified         │
│   🔴 RED     delta% > 2%     → HELD — supervisor must approve          │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                    🟢🟡 OK / AMBER                   🔴 RED tanks exist
                         │                             │
                         │                             ▼
                         │            ┌────────────────────────────────────┐
                         │            │  M4  APPROVAL GATE                 │
                         │            │                                    │
                         │            │  🔔 URGENT Alert → Supervisor      │
                         │            │  📋 Run status → AWAITING APPROVAL │
                         │            │                                    │
                         │            │  ⏸️  WORKFLOW PAUSES HERE          │
                         │            │  (Webhook Wait node — frozen       │
                         │            │   until supervisor acts)           │
                         │            │                                    │
                         │            │  Supervisor opens CAP dashboard    │
                         │            │  → Approval Queue → Approve/Reject │
                         │            │                                    │
                         │            │  CAP calls back to n8n webhook     │
                         │            │  ▶️  WORKFLOW RESUMES              │
                         │            └────────────────────────────────────┘
                         │                             │
                         └──────────────┬──────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  M5  GOODS MOVEMENT POSTING                                              │
│                                                                          │
│   🏭 Build Material Document payload                                    │
│   📤 POST → ZTANK_POST_SRV_SRV (S/4HANA)                               │
│   📄 Material Doc number stored in CAP audit log                        │
│                                                                          │
│   ❌ Posting fails? → Log failure + URGENT Alert (no auto-retry)        │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  M6  ALERTS & REPORT DISTRIBUTION                                        │
│                                                                          │
│   🔔 BTP Alert Notification Service  → Finance + Supervisor             │
│   📧 Email report                    → Configured recipients            │
│   💬 MS Teams webhook                → Operations channel               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### The Approval Pause — Key Concept for New Joiners

The **Webhook Wait node** (step M4) is the most important concept to understand.

```
n8n detects RED tank
        │
        ├──→ Fires URGENT alert to supervisor
        ├──→ Sets CAP run status = AWAITING_APPROVAL
        └──→ ⏸️  SUSPENDS — workflow is frozen, waiting

                    [ Supervisor opens CAP dashboard ]
                    [ Approval Queue → clicks Approve ]

                              CAP sends POST to:
               /webhook/tank-reconciliation/approval-callback

        ▶️  n8n WAKES UP and continues to M5 posting
```

There is **no polling**. The workflow freezes mid-execution and only resumes when the supervisor's browser action triggers the callback. This is how human oversight is enforced without any manual steps in n8n itself.

---

### AppRouter vs n8n — Common Confusion

| | AppRouter (jackal) | n8n |
|---|---|---|
| **What it is** | Front-facing web server | Background pipeline engine |
| **URL** | `https://tank-reconciliation-approuter-proud-jackal-qo.cfapps.us10.hana.ondemand.com` | No public URL — internal to BTP |
| **Who uses it** | Every user — open in a browser | No one opens it directly |
| **What it does** | Serves the React dashboard | Runs the daily reconciliation pipeline |

> When testing, open the **AppRouter (jackal) URL**. n8n runs silently — you see its output in the dashboard run status and audit trail.

---

### Workflow File Location

```
assets/
└── n8n/
    └── workflows/
        └── tank-reconciliation-agent.n8n.json   ← 48-node workflow definition
```

Import this file into any n8n instance to view or edit the workflow visually.

---

## Solution Narrative

See [SOLUTION_NARRATIVE.md](assets/tank-reconciliation-cap/SOLUTION_NARRATIVE.md) for the full business problem, solution overview, challenges, and achievements.
