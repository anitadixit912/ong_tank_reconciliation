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
   - Reads live dips from IS-OIL `OIB_TANKDIP`
   - Computes delta per tank (Physical − Book Stock)
   - Classifies: OK / FLAG / URGENT

2. **Dashboard Updates** — New run in table, 🔔 notification bell updates

3. **Alert Sent (M6)** — Webhook notification fires with run summary

4. **Approval Queue (M4)** — Supervisor reviews URGENT tanks → Approve / Reject

5. **Posting Attempted (M5)** — Goods movement posting via `ZTANK_POST_SRV_SRV`

6. **Audit Trail** — Full M1→M6 history with timestamps and actors

---

## Milestone Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M1 — Data Ingestion | ✅ Working | Live IS-OIL data from OGS/650 |
| M2 — VCF Correction | ✅ Working | VCF factor applied |
| M3 — Variance Calculation | ✅ Working | Live delta with OK/FLAG/URGENT |
| M4 — Approval Decision | ✅ Working | Full governance flow |
| M5 — Goods Movement Posting | ⚠️ Partial | Architecture built; IS-OIL posting config required |
| M6 — Report & Alert Distribution | ✅ Working | Webhook notifications working |

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

## Solution Narrative

See [SOLUTION_NARRATIVE.md](assets/tank-reconciliation-cap/SOLUTION_NARRATIVE.md) for the full business problem, solution overview, challenges, and achievements.
