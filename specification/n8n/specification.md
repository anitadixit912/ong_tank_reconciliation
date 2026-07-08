# Specification: n8n (Reconciliation Agent Workflow)

> **Guidelines**: Read [guidelines.md](../guidelines.md) and [guidelines-n8n-workflow.md](../guidelines-n8n-workflow.md) before executing ANY tasks below. Follow all constraints described there throughout execution.
>
> **Important**: The CAP asset (`tank-reconciliation-cap`) MUST be implemented and running before building this workflow.

## Basic Setup

- [x] Read `product-requirements-document.md` and `intent.md` before starting
- [x] Create the asset directory `assets/n8n/workflows/`
- [x] Create `assets/n8n/asset.yaml`:

```yaml
apiVersion: asset.sap/v1
kind: Asset
type: n8n-workflow
metadata:
  name: tank-reconciliation-n8n
sourceRoot: workflows
```

## Workflow Overview

The Reconciliation Agent is implemented as **one primary n8n workflow** (`tank-reconciliation-agent.n8n.json`) with the following node sequence:

```
[Scheduler / Webhook Trigger]
        ↓
[1. Initialize Run] — POST to CAP: create ReconciliationRun, status=INGESTING
        ↓
[2. Data Collector — ATG Ingest] — HTTP GET from ATG endpoint
        ↓
[3. Data Collector — Fiori Ingest] — HTTP GET Physical Inventory Docs OData
        ↓
[4. Data Collector — HPM Book Stock] — HTTP GET Material Stock OData
        ↓
[5. Data Collector — Merge & Validate] — Code node: merge ATG + Fiori, check completeness
        ↓
[6. M1 Milestone Log] — POST to CAP AuditLog (achieved or missed)
        ↓
[7. Completeness Check] — IF node: all tanks present?
    ├── NO → [7a. Halt & URGENT Alert] → END
    └── YES ↓
[8. VCF Calculator — Read Strapping/Conversion] — HTTP GET Measurement Doc OData
        ↓
[9. VCF Calculator — Call Qty Conversion API] — HTTP POST Hydrocarbon Qty Conversion REST API
        ↓
[10. VCF Fallback Check] — IF node: API success?
    ├── NO → [10a. Apply ASTM Fallback] — Code node with ASTM table
    └── YES ↓ (merge both paths)
[11. VCF Calculator — Compute Net Volumes] — Code node: gross × VCF factor per tank
        ↓
[12. M2 Milestone Log] — POST to CAP AuditLog
        ↓
[13. Variance Engine — Compute Deltas] — Code node: netPhysical - bookStock per tank, deltaPercent
        ↓
[14. Variance Engine — Classify] — Code node: compare deltaPercent vs toleranceOkPct/FlagPct per tank
        ↓
[15. M3 Milestone Log] — POST to CAP AuditLog
        ↓
[16. Save TankResults] — HTTP POST to CAP: upsert all TankResult records with classification
        ↓
[17. Split by Classification] — Switch node: OK / FLAG / URGENT
    ├── OK & FLAG → [18a. Trigger Goods Movement Posting (batch)]
    └── URGENT → [18b. Hold — POST Approval Task to CAP dashboard]
        ↓ (merge after both branches complete)
[19. M4 Wait for Approval] — Webhook Wait node (URGENT path waits for CAP callback)
        ↓
[20. Goods Movement Posting — Material Document] — HTTP POST to S/4HANA Material Doc OData
        ↓
[21. M5 Milestone Log] — POST to CAP AuditLog (posted count, doc IDs or failure)
        ↓
[22. Update Run Status] — HTTP PATCH to CAP: ReconciliationRun status=COMPLETED (or FAILED)
        ↓
[23. Alert Manager — BTP Alert Notification] — HTTP POST to BTP Alert Notification Service
        ↓
[24. Report Generator — Build PDF Data] — Code node: assemble per-tank PDF payload
        ↓
[25. Report Generator — Send Email] — Send Email node
        ↓
[26. Report Generator — Post to MS Teams] — HTTP Request node (Teams webhook)
        ↓
[27. M6 Milestone Log] — POST to CAP AuditLog
```

## Node-by-Node Implementation Tasks

### Trigger Nodes

- [x] **Scheduler Trigger** (`Schedule Trigger` node)
  - Type: `n8n-nodes-base.scheduleTrigger`
  - Cron: `0 6 * * *` (06:00 daily — configurable)
  - Output: `{ runDate: "YYYY-MM-DD" }`

- [x] **Webhook Trigger** (`Webhook` node) — for manual/programmatic trigger from CAP dashboard
  - Path: `/tank-reconciliation/trigger`
  - Method: POST
  - Expected body: `{ runDate: "YYYY-MM-DD", triggeredBy: "user-id" }`
  - Merge both triggers with a `Merge` node (keep first branch)

### Step 1 — Initialize Run

- [x] **Initialize Run** (`HTTP Request` node)
  - Method: POST
  - URL: `https://cap-backend.example.com/odata/v4/ReconciliationService/triggerRun`
  - Body: `{ "runDate": "{{ $json.runDate }}", "triggeredBy": "{{ $json.triggeredBy ?? 'scheduler' }}" }`
  - Save returned `runId` to workflow context

### Step 2–4 — Data Collector (Ingestion)

- [x] **ATG Ingest** (`HTTP Request` node)
  - Method: GET
  - URL: `https://atg-system.example.com/api/readings?date={{ $json.runDate }}`
  - Expected response: array of `{ tankId, grossVolume, temperature, readingTimestamp }`
  - Error handling: if status ≠ 200, set `atgFailed=true`

- [x] **Fiori Physical Inventory Ingest** (`HTTP Request` node)
  - Method: GET
  - URL: `https://your-s4hana-host.example.com/sap/opu/odata/sap/API_PHYSICAL_INVENTORY_DOC_SRV/A_PhysInvtryDocItem?$filter=PostingDate eq '{{ $json.runDate }}'&$select=Material,Plant,StorageLocation,BookQuantityBeforeCount,CountedQuantity,UnitOfMeasure`
  - Map response to `{ tankId (from StorageLocation), fioriVolume: CountedQuantity, material: Material, plant: Plant }`

- [x] **HPM Book Stock Read** (`HTTP Request` node)
  - Method: GET
  - URL: `https://your-s4hana-host.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?$select=Material,Plant,StorageLocation,MatlStkInAcctMod_Stock`
  - Filter by configured plants (use `$filter=Plant eq 'TERM1'`)
  - Map to `{ tankId: StorageLocation, material: Material, plant: Plant, bookStock: MatlStkInAcctMod_Stock }`

### Step 5 — Merge & Validate (Code Node)

- [x] **Merge & Validate** (`Code` node — JavaScript)
  - Merge ATG readings + Fiori readings by `tankId` (ATG takes precedence for volume; Fiori is supplementary)
  - Join with book stock by `tankId`
  - Validate completeness: every configured tank in `TankConfiguration` has a reading and a book stock value
  - Output: `{ complete: boolean, tanks: [...], missingTankIds: [...] }`
  - Log: emit M1 log text: `M1.achieved: data ingestion complete — {tank_count} tanks loaded` or `M1.missed: missing readings for tanks: {tank_ids}`

### Step 6 — M1 Milestone Log (HTTP Request)

- [x] POST to `https://cap-backend.example.com/odata/v4/ReconciliationService/AuditLog`
  - Body: `{ runId, tankId: null, step: 'INGEST', milestone: 'M1', outcome: complete ? 'ACHIEVED' : 'MISSED', message: <M1 log text>, actor: 'system' }`

### Step 7 — Completeness IF Gate

- [x] **IF node**: condition `{{ $json.complete === true }}`
  - TRUE → continue to VCF step
  - FALSE → fire URGENT alert and END (halt run, set run status to FAILED)

### Steps 8–12 — VCF Calculator

- [x] **Read Tank Strapping/Measurement Data** (`HTTP Request` node)
  - Method: GET
  - URL: `https://your-s4hana-host.example.com/sap/opu/odata/sap/API_MEASUREMENTDOCUMENT_0001/MeasurementDocument?$filter=MeasuringPoint eq '{{ tankId }}'`
  - Extract `strappingFactor` and reference temperature from response

- [x] **Call Hydrocarbon Qty Conversion API** (`HTTP Request` node)
  - Method: POST
  - URL: `https://your-s4hana-host.example.com/api/hydrocarbon-quantity-conversion/v1/convert`
  - Body per tank: `{ grossVolume, temperature, materialId, referenceTemperature: 15 }`
  - On success: use returned `vcfFactor` and `netVolume`
  - On error (non-200): set `vcfApiSuccess=false` → route to ASTM fallback

- [x] **ASTM Fallback Code Node** (JavaScript)
  - Implement ASTM D1250 table lookup: given temperature and product type → VCF factor
  - Embed ASTM correction table coefficients as constants in the code node
  - Set `vcfSource = 'ASTM_FALLBACK'` on each tank result
  - Emit fallback warning: `M2.achieved (fallback): VCF fallback used for {tank_ids}`

- [x] **Compute Net Volumes Code Node** (JavaScript)
  - For each tank: `netVolumePhysical = grossVolumeObserved × vcfFactor`
  - Attach `vcfFactor`, `vcfSource`, `strappingFactor`, `temperature` to each tank record

- [x] **M2 Milestone Log** — POST AuditLog: `M2.achieved: VCF correction complete — {tank_count} tanks corrected; fallback_used={true|false}`

### Steps 13–16 — Variance Engine

- [x] **Compute Deltas Code Node** (JavaScript)
  - For each tank: `delta = netVolumePhysical - bookStock`, `deltaPercent = abs(delta) / bookStock × 100`
  - Round to 3 decimal places

- [x] **Classify Code Node** (JavaScript)
  - Read `toleranceOkPct` and `toleranceFlagPct` from `TankConfiguration` (fetched from CAP at run start)
  - If `abs(deltaPercent) <= toleranceOkPct` → `classification = 'OK'`
  - If `abs(deltaPercent) <= toleranceFlagPct` → `classification = 'FLAG'`
  - Else → `classification = 'URGENT'`
  - Attach `toleranceOkPct`, `toleranceFlagPct` to each record for audit

- [x] **Save TankResults** (`HTTP Request` node)
  - Method: POST (batch upsert)
  - URL: `https://cap-backend.example.com/odata/v4/ReconciliationService/TankResults`
  - Body: array of all tank result records with full classification data

- [x] **M3 Milestone Log** — POST AuditLog: `M3.achieved: variance classification complete — OK={ok_count}, FLAG={flag_count}, URGENT={urgent_count}`

### Steps 17–19 — Approval Gate (URGENT path)

- [x] **Switch node** — split by classification: `OK`, `FLAG`, `URGENT`

- [x] **OK + FLAG branch** — batch POST to S/4HANA Material Document API immediately (no approval needed)

- [x] **URGENT branch** — `HTTP Request` to CAP: mark `TankResult.postingStatus = PENDING`; send URGENT alert via BTP Alert Notification Service; set run `status = AWAITING_APPROVAL`

- [x] **Webhook Wait node** — pause workflow and listen for CAP approval callback at `/tank-reconciliation/approval-callback`
  - Resume on POST with body `{ tankResultId, decision: 'APPROVED' | 'REJECTED', runId }`
  - Timeout: 24 hours (then auto-escalate)

- [x] **M4 Milestone Log** — POST AuditLog: `M4.achieved: all URGENT variances resolved — approved={approved_count}, rejected={rejected_count}, approver={user_id}`

### Step 20 — Goods Movement Posting

- [x] **Post Material Document** (`HTTP Request` node)
  - Method: POST
  - URL: `https://your-s4hana-host.example.com/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader`
  - Body per approved tank:
    ```json
    {
      "GoodsMovementCode": "05",
      "DocumentDate": "{{ runDate }}",
      "PostingDate": "{{ runDate }}",
      "to_MaterialDocumentItem": [{
        "Material": "{{ materialId }}",
        "Plant": "{{ plant }}",
        "StorageLocation": "{{ tankId }}",
        "InventoryValuationType": "",
        "GoodsMovementType": "{{ delta < 0 ? '551' : '552' }}",
        "Quantity": "{{ abs(delta) }}",
        "QuantityUnit": "L"
      }]
    }
    ```
  - On success: save `MaterialDocument` number; update `TankResult.postingStatus = POSTED`
  - On failure: set `postingStatus = FAILED`; raise URGENT alert

- [x] **M5 Milestone Log** — POST AuditLog: `M5.achieved: goods movements posted — {posted_count} documents created; material_doc_ids: {doc_ids}` or `M5.missed: posting failed for tanks: {tank_ids}; reason: {error_message}`

### Step 22 — Update Run Status

- [x] **PATCH ReconciliationRun** (`HTTP Request` node)
  - Method: PATCH
  - URL: `https://cap-backend.example.com/odata/v4/ReconciliationService/ReconciliationRuns({{ runId }})`
  - Body: `{ "status": "COMPLETED", "completedAt": "{{ now() }}", "okCount": {ok}, "flagCount": {flag}, "urgentCount": {urgent} }`

### Step 23 — Alert Manager (BTP Alert Notification Service)

- [x] **BTP Alert Notification** (`HTTP Request` node)
  - Method: POST
  - URL: `https://clm.eu10.alert.cloud.sap/v1/notifications/recipients/custom`
  - Headers: `Content-Type: application/json`, `Authorization: Bearer {{ BTP_ANS_TOKEN }}`
  - Body:
    ```json
    {
      "eventType": "TankReconciliationComplete",
      "severity": "{{ urgentCount > 0 ? 'FATAL' : flagCount > 0 ? 'WARNING' : 'INFO' }}",
      "subject": "Tank Reconciliation {{ runDate }} — {{ urgentCount > 0 ? 'URGENT' : flagCount > 0 ? 'FLAG' : 'OK' }}",
      "body": "Run complete: OK={{ okCount }}, FLAG={{ flagCount }}, URGENT={{ urgentCount }}. {{ urgentCount > 0 ? 'Supervisor action required.' : '' }}",
      "recipients": ["finance-accountant@example.com", "terminal-supervisor@example.com"]
    }
    ```

### Steps 24–27 — Report Generator

- [x] **Build PDF Payload Code Node** (JavaScript)
  - Assemble a structured JSON object containing all `TankResult` data for the run
  - Structure: `{ runDate, runId, summary: { ok, flag, urgent }, tanks: [ { tankId, tankName, grossVolume, temperature, vcfFactor, netVolume, bookStock, delta, deltaPercent, classification, postingStatus, materialDocumentId } ] }`

- [x] **Generate PDF** (`HTTP Request` node or `HTML to PDF` community node)
  - If using HTTP: POST to a PDF generation service endpoint `{{ PDF_SERVICE_URL }}/generate`
  - If using community node: use `n8n-nodes-base.htmlExtract` to render HTML template then convert
  - Template must include: run header, per-tank table, classification colour coding (OK=green, FLAG=amber, URGENT=red), VCF fallback warning if applicable

- [x] **Send Email** (`Send Email` node — `n8n-nodes-base.emailSend`)
  - To: configurable recipient list (env var `REPORT_EMAIL_RECIPIENTS`)
  - Subject: `Tank Reconciliation Report — {{ runDate }}`
  - Body: summary text with PDF attached
  - Note: assign SMTP credentials manually in n8n UI after import

- [x] **Post to MS Teams** (`HTTP Request` node)
  - Method: POST
  - URL: `{{ TEAMS_WEBHOOK_URL }}` (env var — Teams Incoming Webhook URL)
  - Body:
    ```json
    {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      "summary": "Tank Reconciliation Report {{ runDate }}",
      "themeColor": "{{ urgentCount > 0 ? 'FF0000' : flagCount > 0 ? 'FFA500' : '00FF00' }}",
      "title": "Tank Reconciliation {{ runDate }} — {{ urgentCount > 0 ? 'URGENT' : flagCount > 0 ? 'FLAG' : 'OK' }}",
      "text": "Run complete: OK={{ okCount }}, FLAG={{ flagCount }}, URGENT={{ urgentCount }}."
    }
    ```

- [x] **M6 Milestone Log** — POST AuditLog: `M6.achieved: reconciliation report distributed` or `M6.missed: report distribution failed`

## Error Handling

- [x] Add **Error Trigger** node — catches any uncaught workflow error
  - PATCH run status to `FAILED` in CAP
  - POST URGENT alert via BTP ANS: `"Tank reconciliation run FAILED for {{ runDate }}. Manual intervention required."`
  - POST M-level missed milestone log to CAP AuditLog

- [x] For each HTTP Request node calling S/4HANA, add `onError: continueRegularOutput` with explicit failure branch:
  - Log the failure to CAP AuditLog
  - Set affected `TankResult.postingStatus = FAILED`
  - Continue run (do not abort for single-tank failure)

## Environment Variables (Configured in n8n UI)

Document the following variables in a comment node at the top of the workflow:

| Variable | Purpose |
|---|---|
| `CAP_BASE_URL` | CAP backend base URL, e.g. `https://cap-backend.example.com` |
| `S4_BASE_URL` | S/4HANA host, e.g. `https://your-s4hana-host.example.com` |
| `ATG_BASE_URL` | ATG system API base URL |
| `BTP_ANS_URL` | BTP Alert Notification Service endpoint |
| `BTP_ANS_TOKEN` | BTP ANS bearer token |
| `TEAMS_WEBHOOK_URL` | MS Teams Incoming Webhook URL |
| `REPORT_EMAIL_RECIPIENTS` | Comma-separated email list for report distribution |
| `PDF_SERVICE_URL` | PDF generation service URL (if using external service) |

## Validation

- [x] Validate `tank-reconciliation-agent.n8n.json` is well-formed JSON ✓
- [x] Confirm `connections` reference nodes by `name` not `id` ✓ (0 connection errors)
- [x] Confirm no `credentials` blocks exist in any node ✓ (0 found)
- [x] Confirm no hardcoded hostnames — all SAP and CAP URLs use `$vars.*` placeholders ✓
- [x] Confirm M1–M6 milestone log nodes are present and structured per PRD milestone definitions ✓
