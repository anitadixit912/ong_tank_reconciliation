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
- [x] React dashboard Vite build completes successfully — 1883 modules, 0 errors (includes TrendChart R12 page)

## Dip Reading Management Module (Enhancement)

### Data Model Addition

- [x] Added `DipReading` entity to `db/schema.cds`:
  - `tankId` : String(20) — 20-char zero-padded SOCNR
  - `tankName` : String(100)
  - `measurementDate` : Date
  - `measurementTime` : String(6) — HHMMSS format
  - `dipType` : String(1) — I=Innage, U=Ullage
  - `dipValue` : Decimal(15,3)
  - `dipUnit` : String(3) — MM / CM / FT / BBL / M3
  - `waterHeight` : Decimal(10,3)
  - `waterHeightUnit` : String(3)
  - `temperature` : Decimal(7,3) — degrees Celsius
  - `density` : Decimal(10,4) — kg/m³
  - `dipEvent` : String(50)
  - `inputMethod` : String(15) — MANUAL / EXCEL / AI_PROMPT
  - `postingStatus` : String(20) — DRAFT / SUBMITTED / POSTED / FAILED / PENDING_ABAP
  - `bapiResponse` : String(2000)
  - `notes` : String(1000)

### CAP Service Actions

- [x] Added to `srv/reconciliation-service.cds`:
  - `DipReadings` entity projection
  - `saveDipReading(...)` — saves new dip reading in CAP (status: DRAFT)
  - `saveDipToSAP(dipReadingId)` — posts dip to SAP IS-Oil via OGS_S4 destination
  - `batchSaveDipsToSAP(dipReadingIds)` — batch post for Excel upload
  - `parseDipFromPrompt(text, sessionId)` — AI extraction via `aicore` destination

- [x] Implemented handlers in `srv/reconciliation-service.js`:
  - `saveDipToSAP` posts to `ZTANK_DIP_SRV_SRV/TankDipSet` with fields: `Socnr`, `Etmstm`, `TotalheightFltp`, `Meins`, `WaterheightFltp`
  - CSRF token fetch → POST → status lifecycle (SUBMITTED → POSTED / FAILED / PENDING_ABAP)
  - `parseDipFromPrompt` calls `aicore` destination — never returns fabricated values

### React UI

- [x] Added `💧 Dip Entry` page at `/dip-entry` (`app/react-ui/src/pages/DipEntry.jsx`):
  - **Tab 1 — Manual Entry**: form with all BAPI fields, Save Draft + Save & Post buttons
  - **Tab 2 — Excel Upload**: drag-drop .xlsx/.csv, flexible column mapping, batch post
  - **Tab 3 — AI Prompt**: free text → `parseDipFromPrompt` → auto-fills manual form
  - **History table**: last 50 dip readings with status badges and Post to SAP action

### SAP IS-Oil Integration (ABAP)

- [x] BAPI confirmed working: `BAPI_CREATE_DIPS_EXT` (function group `OIIC_DIP`)
- [x] SEQ_NO resolved via table `OIISOCISL` (SOCNR → WERKS + LGORT + SEQNR)
  - Tank 23 (SOCNR `00000000000000000023`): PLANT=1743, SLOC=17T1, SEQNR=`USMOB-17T2`
  - Tank 5  (SOCNR `00000000000000000005`): PLANT=1743, SLOC=17T1, SEQNR=`USMOB-17T1`
- [x] ABAP CREATE method implemented in `ZCL_ZTANK_DIP_SRV_DPC_EXT` → `/IWBEP/IF_MGW_APPL_SRV_RUNTIME~CREATE_ENTITY`
  - Reads SOCNR from OData input
  - Looks up WERKS + LGORT + SEQNR from `OIISOCISL`
  - Calls `BAPI_CREATE_DIPS_EXT` → `BAPI_TRANSACTION_COMMIT`

### New CF Asset: tank-dip-mcp-server

- [x] Created `assets/tank-dip-mcp-server/` — Python MCP/SSE server on CF
  - 8 MCP tools: `get_tank_configurations`, `get_tank_dips`, `list_dip_readings`, `create_dip_reading`, `post_dip_to_sap`, `batch_post_dips_to_sap`, `trigger_reconciliation_run`, `get_reason_codes`
  - Mirrors `nomination-mcp-server` pattern
  - Calls CAP backend via `httpx`

### Agent Enhancement

- [x] Updated `tank-reconciliation-agent` with 5 new LangChain tools for dip management
- [x] Updated agent system prompt with autonomous 4-step dip-to-reconciliation pipeline
- [x] Updated `SKILL.md` with dip parameters reference

## Requirements Coverage (R01–R13)

- [x] **R01** Dual-Source Data Ingestion — n8n ATG + Fiori ingest nodes (Data Collector steps 2–5)
- [x] **R02** VCF Correction — n8n VCF Calculator with ASTM fallback (steps 8–12)
- [x] **R03** Per-Tank Variance Calculation and Classification — n8n Variance Engine (steps 13–16)
- [x] **R04** Supervisor Approval Workflow — CAP `approvePosting`/`rejectPosting` actions + ApprovalQueue UI
- [x] **R05** HPM Goods Movement Posting — n8n Material Document POST to S/4HANA (step 20)
- [x] **R06** OK/FLAG/URGENT Alerting — n8n Alert Manager + BTP ANS (step 23)
- [x] **R07** Per-Tank Variance PDF Report — n8n Report Generator + Email + MS Teams (steps 24–27)
- [x] **R08** Unified CAP Dashboard — React UI with Dashboard, TankDetail, ApprovalQueue, AuditTrail, Configuration, TrendChart views
- [x] **R09** Immutable Audit Log — `AuditLogEntry` entity; all handlers write M1–M6 milestone log entries
- [x] **R10** Configurable Tolerance Thresholds per Tank — `TankConfiguration` with `toleranceOkPct`/`toleranceFlagPct`; admin CRUD UI
- [x] **R11** Run Re-trigger on Data Completeness Failure — `retriggerDataCollection` action in CAP + "↺ Re-trigger" button on Dashboard for FAILED/PENDING runs; 4 new handler tests pass
- [x] **R12** Trend Visualisation — Tank Variance History — `TankVarianceTrend` view in schema; `TrendChart.jsx` page with SVG sparklines, 30-day delta history per tank; `/trends` route in App
- [x] **R13** Multi-Terminal Support — `terminalId`/`terminalName` fields on `TankConfiguration`; seed CSV updated with TERM-NORTH/TERM-SOUTH; Configuration UI shows terminal column; `fetchTerminals()` API helper
