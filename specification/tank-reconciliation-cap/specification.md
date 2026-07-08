# Specification: tank-reconciliation-cap

> **Guidelines**: Read [guidelines.md](../guidelines.md) and [guidelines-cap.md](../guidelines-cap.md) before executing ANY tasks below. Follow all constraints described there throughout execution.

## Basic Setup

- [x] Read `product-requirements-document.md` and `intent.md` before starting
- [x] Invoke the `cap-development` skill from `assets/tank-reconciliation-cap/` to initialise the CAP project structure
- [x] Run `npm install` inside `assets/tank-reconciliation-cap/`
- [x] Validate the project starts: run `cds watch` and confirm it responds on port 4004
- [x] Create `assets/tank-reconciliation-cap/asset.yaml` as specified in `../guidelines-cap.md`

## Data Model — CDS Entities

- [x] Create `assets/tank-reconciliation-cap/db/schema.cds` with the following entities:

  **ReconciliationRun** — one record per daily cycle
  - `ID` : UUID (key)
  - `runDate` : Date
  - `status` : String enum — `PENDING | INGESTING | VCF_CALC | VARIANCE | AWAITING_APPROVAL | POSTING | COMPLETED | FAILED`
  - `triggeredBy` : String (scheduler or user ID)
  - `triggeredAt` : Timestamp
  - `completedAt` : Timestamp (nullable)
  - `tankCount` : Integer
  - `okCount` : Integer
  - `flagCount` : Integer
  - `urgentCount` : Integer
  - `vcfFallbackUsed` : Boolean (default false)
  - `auditNotes` : String (nullable)

  **TankResult** — one record per tank per run
  - `ID` : UUID (key)
  - `run` : Association to ReconciliationRun
  - `tankId` : String
  - `tankName` : String
  - `materialId` : String
  - `plant` : String
  - `grossVolumeObserved` : Decimal(15,3)
  - `temperature` : Decimal(7,3)
  - `strappingFactor` : Decimal(10,6)
  - `vcfFactor` : Decimal(10,6)
  - `netVolumePhysical` : Decimal(15,3)
  - `bookStock` : Decimal(15,3)
  - `delta` : Decimal(15,3)
  - `deltaPercent` : Decimal(7,4)
  - `classification` : String enum — `OK | FLAG | URGENT`
  - `toleranceOkPct` : Decimal(5,2)
  - `toleranceFlagPct` : Decimal(5,2)
  - `postingStatus` : String enum — `PENDING | POSTED | REJECTED | FAILED`
  - `materialDocumentId` : String (nullable)
  - `rejectionReason` : String (nullable)
  - `vcfSource` : String enum — `API | ASTM_FALLBACK`

  **ApprovalRecord** — approval/rejection decision for URGENT tanks
  - `ID` : UUID (key)
  - `tankResult` : Association to TankResult
  - `run` : Association to ReconciliationRun
  - `decision` : String enum — `APPROVED | REJECTED`
  - `decidedBy` : String (user ID)
  - `decidedAt` : Timestamp
  - `comment` : String (nullable — mandatory when REJECTED)

  **AuditLogEntry** — immutable log per run step
  - `ID` : UUID (key)
  - `run` : Association to ReconciliationRun
  - `tankId` : String (nullable — null for run-level entries)
  - `step` : String enum — `INGEST | VCF | VARIANCE | APPROVAL | POSTING | ALERT | REPORT`
  - `milestone` : String (M1–M6)
  - `outcome` : String enum — `ACHIEVED | MISSED`
  - `message` : String (structured log text per PRD milestones)
  - `timestamp` : Timestamp
  - `actor` : String (system or user ID)
  - `inputSummary` : String (nullable)
  - `outputSummary` : String (nullable)

  **TankConfiguration** — per-tank tolerance and metadata config
  - `tankId` : String (key)
  - `tankName` : String
  - `materialId` : String
  - `plant` : String
  - `toleranceOkPct` : Decimal(5,2) (default 0.10)
  - `toleranceFlagPct` : Decimal(5,2) (default 0.25)
  - `atgEndpoint` : String (nullable)
  - `active` : Boolean (default true)

- [x] Run `cds compile db/` to validate schema compiles without errors

## CAP Service Layer

- [x] Create `assets/tank-reconciliation-cap/srv/reconciliation-service.cds` exposing:

  - `ReconciliationRuns` — full CRUD (admin) + action `triggerRun(runDate: Date)` returns RunStatus
  - `TankResults` — read + action `approvePosting(tankResultId: UUID, comment: String)` + action `rejectPosting(tankResultId: UUID, comment: String)`
  - `ApprovalRecords` — read-only
  - `AuditLog` — read-only, filterable by runId, tankId, dateRange
  - `TankConfigurations` — full CRUD (admin)
  - `DashboardStats` — virtual/projection entity: current run status, counts per classification, last run summary

- [x] Create `assets/tank-reconciliation-cap/srv/reconciliation-service.js` with custom handlers:

  **`triggerRun` action handler**
  - Create a new `ReconciliationRun` record with status `PENDING`
  - Call the n8n webhook endpoint (configurable via env var `N8N_WEBHOOK_URL`) via HTTP POST with `{ runId, runDate }`
  - Log `M1 trigger initiated` to AuditLog
  - Return the new run ID and status

  **`approvePosting` action handler**
  - Validate the `TankResult` exists and has classification `URGENT` and postingStatus `PENDING`
  - Create `ApprovalRecord` with decision `APPROVED`
  - Update `TankResult.postingStatus` to `PENDING` (n8n will pick up and post)
  - Notify n8n approval webhook: POST `{ tankResultId, decision: 'APPROVED', runId }` to `N8N_APPROVAL_CALLBACK_URL`
  - Write AuditLog entry: step `APPROVAL`, milestone `M4`, outcome `ACHIEVED`

  **`rejectPosting` action handler**
  - Validate comment is non-empty (mandatory for rejection)
  - Create `ApprovalRecord` with decision `REJECTED`
  - Update `TankResult.postingStatus` to `REJECTED`
  - Notify n8n rejection webhook
  - Write AuditLog entry: step `APPROVAL`, milestone `M4`, outcome `ACHIEVED` (rejection is a valid resolution)

  **`DashboardStats` read handler**
  - Return aggregated counts for today's active run: totalTanks, okCount, flagCount, urgentCount, pendingApproval, posted, failed
  - Return last 5 completed run summaries

- [x] Write tests for `triggerRun`, `approvePosting`, `rejectPosting` handlers — verify state transitions, audit log entries, and rejection comment validation

## Mock Data

- [x] Create `assets/tank-reconciliation-cap/db/data/` with CSV seed files:
  - `TankConfiguration.csv` — 5 sample tanks (TK-001 to TK-005) with realistic tolerance values
  - `ReconciliationRun.csv` — 3 historical completed runs (status `COMPLETED`)
  - `TankResult.csv` — results for the 3 historical runs covering OK, FLAG, and URGENT classifications
  - `AuditLogEntry.csv` — sample audit entries for M1–M6 milestones across the historical runs

## API Specs — S/4HANA OData Reference

The following S/4HANA OData APIs are consumed by the n8n Reconciliation Agent. The CAP layer does **not** call these directly — n8n calls them and writes results back to CAP. Store specs here for reference:

- [ ] Save `specification/tank-reconciliation-cap/api-specs/API_MATERIAL_DOCUMENT_SRV.edmx` — Material Documents Read/Create
  - ORD ID: `sap.s4:apiResource:API_MATERIAL_DOCUMENT_SRV:v1`
  - Base path: `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV`
  - Key entity: `MaterialDocumentHeader` — POST to create goods movement
  - Key fields: `MaterialDocument`, `MaterialDocumentYear`, `GoodsMovementType` (551=shrinkage, 552=gain)

- [ ] Save `specification/tank-reconciliation-cap/api-specs/API_MATERIAL_STOCK_SRV.edmx` — Material Stock Read
  - ORD ID: `sap.s4:apiResource:API_MATERIAL_STOCK_SRV:v1`
  - Base path: `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV`
  - Key entity: `A_MatlStkInAcctMod` — read unrestricted stock by Material + Plant + StorageLocation
  - Key field: `MatlStkInAcctMod_Stock` (unrestricted stock quantity)

- [ ] Save `specification/tank-reconciliation-cap/api-specs/API_PHYSICAL_INVENTORY_DOC_SRV.edmx` — Physical Inventory Documents
  - ORD ID: `sap.s4:apiResource:API_PHYSICAL_INVENTORY_DOC_SRV:v1`
  - Base path: `/sap/opu/odata/sap/API_PHYSICAL_INVENTORY_DOC_SRV`
  - Key entity: `A_PhysInvtryDocItem` — read Fiori manual dip entries by Plant + StorageLocation + Material

- [ ] Save `specification/tank-reconciliation-cap/api-specs/MEASUREMENTDOCUMENT_0001.edmx` — Measurement Document
  - ORD ID: `sap.s4:apiResource:MEASUREMENTDOCUMENT_0001:v1`
  - Base path: `/sap/opu/odata/sap/API_MEASUREMENTDOCUMENT_0001`
  - Key entity: `MeasurementDocument` — read ATG gauge readings and tank master measurement points

## React Dashboard (UI)

- [x] Scaffold the React frontend in `assets/tank-reconciliation-cap/app/react-ui/` with SAP UI5 Web Components + React Router

- [x] Implement the following views:

  **Dashboard Home (`/`)**
  - Live pipeline progress bar: Ingestion → VCF → Variance → Approval → Posted
  - Today's run status card: status, total tanks, OK / FLAG / URGENT counts
  - "Trigger Today's Run" button (calls `triggerRun` action) — disabled if run already in progress
  - Last 5 completed runs summary table (date, status, OK/FLAG/URGENT counts, PDF link)

  **Tank Detail View (`/runs/:runId`)**
  - Table of all `TankResult` records for the run
  - Columns: Tank ID, Tank Name, Gross Volume, Temperature, VCF Factor, Net Volume, Book Stock, Delta, Delta %, Classification badge (colour-coded: green/amber/red), Posting Status
  - VCF fallback warning indicator if `vcfSource = ASTM_FALLBACK`
  - Filter by classification (OK / FLAG / URGENT)

  **Approval Queue (`/approvals`)**
  - List of all `TankResult` records with `classification = URGENT` and `postingStatus = PENDING`
  - Each row: Tank ID, Delta, Delta %, Tolerance Band, Run Date
  - Approve button → opens modal with tank detail + comment field (optional for approval)
  - Reject button → opens modal with mandatory comment field
  - Submits to `approvePosting` / `rejectPosting` actions

  **Audit Trail (`/audit`)**
  - Filterable table of `AuditLogEntry` records
  - Filters: Run Date range, Tank ID, Milestone (M1–M6), Outcome (ACHIEVED/MISSED)
  - Columns: Timestamp, Run ID, Tank ID, Step, Milestone, Outcome, Actor, Message

  **Configuration (`/config`)**
  - CRUD table for `TankConfiguration` records
  - Inline edit for tolerance thresholds (OkPct, FlagPct) per tank
  - Toggle active/inactive per tank

- [x] Wire all views to the CAP OData service via proxy config in vite.config.js
- [x] Apply role-based view access:
  - Approval Queue: visible only to users with role `Supervisor`
  - Configuration: visible only to users with role `Administrator`
  - Dashboard and Audit Trail: visible to all authenticated users

## Validation & Tests

- [x] Run `cds compile srv/` — must pass with zero errors
- [x] Run `npm test` — all handler tests must pass (10/10 green)
- [x] Run `cds watch` and verify:
  - `GET /reconciliation/ReconciliationRuns` returns seed data (3 rows ✓)
  - `GET /reconciliation/TankResults` returns seed data (15 rows ✓)
  - `GET /reconciliation/AuditLog` returns audit entries (16 rows ✓)
  - `GET /reconciliation/TankConfigurations` returns config (5 rows ✓)
- [x] React dashboard Vite build completes successfully — 1881 modules, 0 errors
