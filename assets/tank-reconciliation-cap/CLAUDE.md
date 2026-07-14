# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tank Stock Reconciliation — a full-stack SAP CAP (Cloud Application Programming) application deployed on SAP BTP. It compares physical tank measurements (ATG) against S/4HANA book stock, classifies variances, and routes urgent ones through an approval workflow.

## Commands

### Local Development
```bash
# From repo root — starts CDS server with SQLite in-memory, auto-reloads on change
cds watch

# Run all tests
npm test

# React UI dev server (proxies /reconciliation to localhost:4004)
cd app/react-ui && npm run dev
```

### Build for BTP Deployment
```bash
# Full build: npm install + cds build --production + React Vite build + gen/srv packaging
node build.js
```

### Run a single test file
```bash
node --test test/reconciliation-service.test.js
```

## Architecture

### Layer Structure
```
db/schema.cds              → Domain model (namespace: tank.reconciliation)
srv/reconciliation-service.cds  → OData service definition + actions
srv/reconciliation-service.js   → Service implementation (handlers, S/4HANA calls)
app/react-ui/              → React 19 + SAP UI5 WebComponents (Fiori design)
gen/                       → Build output; DO NOT edit manually
```

> **Important:** `gen/srv/` is the packaged runtime artifact produced by `build.js`. If Claude Code is invoked from inside `gen/srv/`, all source edits should still target the source files at the repo root (`srv/`, `db/`, `app/react-ui/`), then rebuilt via `node build.js`.

### CDS Configuration (package.json `cds` block)
- **Development**: SQLite in-memory, dummy auth (no credentials needed)
- **Production**: SQLite file (`db.sqlite`), XSUAA auth
- S/4HANA is consumed via a BTP destination named `S4HANA_PUBLIC_CLOUD` (overridable via `S4HANA_DESTINATION_NAME` env var)

### Service Security Model
Four roles enforce access in `reconciliation-service.cds`:
- `ReconciliationUser` — read-only
- `ReconciliationApprover` — approve/reject urgent variances
- `ReconciliationAdmin` — full access including `TankConfigurations` and triggering runs
- `OGSIntegration` — machine-to-machine (IS-OIL OGS system)

### Key Business Logic (`srv/reconciliation-service.js`)
- `triggerRun(runDate)` — fetches book stock from `API_MATERIAL_STOCK_SRV` and physical inventory from `API_PHYSICAL_INVENTORY_DOC_SRV`, computes delta/deltaPercent, classifies as OK / FLAG / URGENT against per-tank tolerances in `TankConfiguration`
- `approvePosting` / `rejectPosting` — write to `ApprovalRecord`, update `TankResult.postingStatus`
- `retriggerDataCollection(runId)` — re-runs data collection for FAILED or PENDING runs
- `chat(message, sessionId)` — proxies to AI Core via `aicore` destination
- Audit trail written to `AuditLogEntry` at milestones M1–M4

### Frontend (`app/react-ui/`)
- Entry: `src/main.jsx` (HashRouter + ThemeProvider)
- API calls centralized in `src/api.js`
- Auth state in `src/AuthContext.jsx`
- Pages: Dashboard, TankDetail, ApprovalQueue, AuditTrail, TrendChart, AiChat, Configuration

### Build Pipeline (`build.js`)
The BTP build container expects `/outputs` with node_modules pre-installed. `build.js` orchestrates: `cds build --production` → Vite build → copy React dist into `gen/srv/app/` → `npm install --production` in `gen/srv/` → copy everything to `/outputs`.

### Deployment
- `mta.yaml` — SAP BTP MTA deployment (HANA HDI + XSUAA + Destination service)
- `manifest.yml` — Cloud Foundry push (uses SQLite, no HANA, for lightweight CF deployment)
- `xs-security.json` — XSUAA role templates and role collections

### S/4HANA APIs Used
| API | Purpose |
|-----|---------|
| `API_MATERIAL_STOCK_SRV` | Book stock per material/plant |
| `API_PHYSICAL_INVENTORY_DOC_SRV` | Physical inventory counts |
| `API_PLANT_SRV` | Plant value help (`getPlants` action) |
