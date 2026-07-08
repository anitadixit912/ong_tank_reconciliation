# Product Requirements Document (PRD)

**Title:** Hydrocarbon Tank Reconciliation — E2E Daily Workflow  
**Date:** 2026-07-07  
**Owner:** Terminal Operations / Supply Chain  
**Solution Category:** n8n Workflow, BTP Extension

---

## Product Purpose & Value Proposition

**Elevator Pitch:**
Hydrocarbon terminals lose hours every day reconciling tank stock manually across disconnected systems. This solution automates the entire chain — from field gauge readings to S/4HANA goods movement posting — giving every role a single, real-time cockpit and eliminating reconciliation errors before they reach the ledger.

**Business Need:**
Terminal operators capture daily tank measurements via two channels: continuous ATG (Automatic Tank Gauging) electronic readings and manual dip entries through the Fiori Mobile Ticket Data Capture app. These readings must be VCF-corrected, compared against HPM book stock, and — where variances exceed tolerance — held for supervisor approval before goods movements are posted. Today this process is fragmented across multiple SAP transactions, manual spreadsheets, and email chains, creating audit risk, custody transfer errors, and delayed financial postings.

**Expected Value:**
- Eliminate manual reconciliation effort for stock controllers on routine (within-tolerance) runs
- Reduce variance-to-posting cycle time from hours to minutes for flagged exceptions
- Provide a complete, tamper-evident audit trail per reconciliation run for compliance and custody transfer
- Deliver real-time OK / FLAG / URGENT alerts to Finance and Supervisors via SAP BTP Alert Notification Service

**Product Objectives:**
1. Automate the full daily reconciliation cycle — from ATG/Fiori ingestion to goods movement posting — with zero manual steps for within-tolerance tanks
2. Enforce a structured approval gate for URGENT variances before any goods movement is posted
3. Provide a unified, role-appropriate dashboard for all five user roles (operator, stock controller, supervisor, finance, compliance)
4. Distribute a per-tank variance PDF report to Email and MS Teams after every completed run
5. Maintain a full, immutable audit log of every run, classification decision, approval action, and posting outcome

---

## User Profiles & Personas

### Primary Persona: Carlos — Terminal Supervisor

Carlos is a 44-year-old operations lead at a coastal petroleum terminal, responsible for four product tanks and two shift teams. He manages 20+ OData transactions daily and is accountable for custody transfer accuracy. His day starts by checking overnight ATG readings against the previous day's book stock — a process that currently involves three SAP screens, two spreadsheets, and a phone call to the stock controller. He needs to act on exceptions fast; delayed approvals block morning deliveries. He is technically proficient with SAP but frustrated by the lack of a single exception view. Success for Carlos: no custody transfer disputes and no delayed loadings.

### Secondary Persona: Amara — Stock Controller / Inventory Analyst

Amara is a 34-year-old inventory specialist who runs the daily reconciliation cycle. She spends 2–3 hours each morning collecting ATG data, applying VCF corrections manually in Excel, comparing to SAP book stock, and preparing the daily variance report. Any discrepancy requires back-and-forth with Carlos before she can post the goods movement. She is detail-oriented and distrustful of automation she cannot audit. Success for Amara: a single screen showing every tank's status, the VCF-corrected figure, and the book-vs-physical delta — with a full trail of how the numbers were derived.

### Secondary Persona: Fatima — Finance Accountant

Fatima is a 38-year-old finance officer responsible for daily inventory valuation and shrinkage/gain postings. She currently receives reconciliation results via email, often hours after the terminal run completes, and must chase Carlos for approval status before closing the daily position. She needs timely, structured alerts that tell her the run outcome and whether goods movements have been posted. She does not need to operate the workflow — she needs to trust it and receive reliable, timestamped confirmation.

### Other User Types

- **Field Operator / Gauger** — enters manual dip readings via the Fiori Mobile Ticket Data Capture app; views ingestion status in the dashboard
- **Compliance Officer** — accesses historical reconciliation reports and audit records; read-only

---

## User Goals & Tasks

### For Carlos (Terminal Supervisor):
**Goals:**
- Receive immediate notification when a tank variance is classified URGENT
- Review the flagged variance detail and approve or reject the goods movement posting from a single screen
- Confirm all daily runs are complete and posted before morning loadings begin

**Key Tasks:**
- Open the CAP dashboard approval queue and review URGENT-flagged tanks
- View per-tank VCF-corrected volume, book stock, delta, and tolerance band
- Approve or reject the run; add a comment if rejecting
- Receive the consolidated PDF report in MS Teams after run completion

### For Amara (Stock Controller):
**Goals:**
- Monitor the daily reconciliation run from ingestion through posting without manual intervention
- Drill into any tank's variance detail to verify the VCF calculation and data source
- Access the full audit trail for any historical run

**Key Tasks:**
- View the live run status dashboard (Ingestion → VCF → Variance → Approval → Posted)
- Inspect per-tank readings, correction factors, deltas, and tolerance classification
- Download or review the generated variance PDF for any completed run

---

## Product Principles

1. **Automation by default, human control by exception** — the system acts autonomously unless a variance exceeds tolerance; human involvement is limited to genuine exceptions.
2. **No posting without audit trail** — every goods movement is preceded by a complete, traceable record of the measurement, correction, variance, and approval chain.
3. **One cockpit for all roles** — every role from field operator to compliance officer uses the same CAP dashboard, with role-appropriate views; no side-channel spreadsheets.
4. **Tolerance configurability** — OK / FLAG / URGENT thresholds are stored as CAP configuration parameters, not hardcoded; terminals with different products or regulatory requirements tune independently.

---

## Goals and Non-Goals

### Goals (In Scope)
- Ingest daily ATG electronic readings and Fiori manual dip entries into a unified reconciliation run
- Read HPM book stock, Tank Master Data, Tank Strapping Calibration Tables, and VCF/Qty Conversion Tables from S/4HANA IS-OIL HPM
- Apply VCF correction (Gross → Net volume) using SAP Hydrocarbon Quantity Conversion API with ASTM table fallback
- Compute per-tank variance and classify as OK / FLAG / URGENT against configurable thresholds
- Auto-post goods movements for OK/FLAG tanks; hold URGENT tanks for supervisor approval via CAP dashboard
- Deliver OK / FLAG / URGENT alerts via SAP BTP Alert Notification Service to Finance Accountant and Supervisor
- Generate per-tank variance PDF and distribute to Email and MS Teams after every run
- Persist a complete, immutable audit log per run in CAP

### Non-Goals (Out of Scope)
- Replacing the Fiori Mobile Ticket Data Capture app — it remains the field entry tool; this solution reads its output
- Blending or production order management — tank reconciliation only, no refinery scheduling
- Multi-terminal consolidation reporting across different SAP systems
- Automated ATG hardware provisioning or protocol configuration
- Real-time streaming reconciliation — one scheduled run per day

---

## Requirements

### Must-Have Requirements

**R01: Dual-Source Data Ingestion**
- **Problem to Solve:** Two independent field measurement sources (ATG and Fiori manual dip) must be merged into a single validated dataset before reconciliation can proceed.
- **User Story:** As a stock controller, I need the system to automatically collect both ATG readings and Fiori manual dip entries each day so that I never have to manually combine two data sources.
- **Acceptance Criteria:**
  - Given the daily scheduler fires, when the Data Collector runs, then both ATG and Fiori readings are ingested and cross-validated for completeness within 5 minutes
  - Given a reading source is unavailable or incomplete, when the Data Collector detects the gap, then the run is paused and an URGENT alert is raised before VCF correction begins
- **Maps to Objective:** 1
- **Priority Rank:** 1

**R02: VCF Correction (Gross → Net Volume)**
- **Problem to Solve:** Raw observed volumes must be corrected for temperature and density before comparison with book stock; without this, variance figures are meaningless for custody transfer.
- **User Story:** As a stock controller, I need the system to apply Volume Correction Factors using the tank's strapping calibration and temperature conversion tables so that physical volumes are expressed in standard conditions before comparison.
- **Acceptance Criteria:**
  - Given validated gauge readings are available, when the VCF Calculator runs, then each tank's gross observed volume is converted to net standard volume using Tank Strapping Calibration Tables and VCF/Qty Conversion Tables from HPM
  - Given the SAP Hydrocarbon Quantity Conversion API is unavailable, when the VCF Calculator runs, then the ASTM fallback table stored in CAP is used and the fallback is flagged in the audit log
- **Maps to Objective:** 1
- **Priority Rank:** 2

**R03: Per-Tank Variance Calculation and Classification**
- **Problem to Solve:** The net physical volume must be compared against the HPM book stock figure, and each tank's result classified so the right action is taken automatically.
- **User Story:** As a stock controller, I need each tank's physical-vs-book delta to be automatically classified as OK, FLAG, or URGENT against configurable thresholds so that I only need to act on genuine exceptions.
- **Acceptance Criteria:**
  - Given VCF-corrected volumes and HPM book stock are available, when the Variance Engine runs, then each tank receives a delta value and one of three classifications (OK / FLAG / URGENT)
  - Given a tank is classified OK or FLAG, when goods movement posting is triggered, then the Material Document is created in S/4HANA without human intervention
  - Given a tank is classified URGENT, when the Variance Engine runs, then the posting is held and an approval task is created in the CAP dashboard
- **Maps to Objective:** 1, 2
- **Priority Rank:** 3

**R04: Supervisor Approval Workflow**
- **Problem to Solve:** URGENT variances must not reach the S/4HANA ledger without an authorised human decision.
- **User Story:** As a terminal supervisor, I need to review all URGENT-flagged tanks and explicitly approve or reject their goods movement posting from the CAP dashboard so that no out-of-tolerance movement is posted without my sign-off.
- **Acceptance Criteria:**
  - Given an URGENT variance exists, when Carlos opens the CAP dashboard, then he sees the tank ID, corrected volume, book stock, delta, tolerance band, and a two-action control (Approve / Reject with mandatory comment on rejection)
  - Given Carlos approves, when the approval is submitted, then the goods movement posting fires within 2 minutes and the decision is written to the audit log
  - Given Carlos rejects, when the rejection is submitted, then the posting is cancelled, the rejection reason is stored, and Amara is notified
- **Maps to Objective:** 2
- **Priority Rank:** 4

**R05: HPM Goods Movement Posting**
- **Problem to Solve:** Shrinkage and gain must be posted as Material Documents in S/4HANA to close the daily inventory position with accurate financial postings.
- **User Story:** As a finance accountant, I need goods movement postings to be created automatically in S/4HANA after each reconciliation run so that the daily inventory valuation is always current and traceable.
- **Acceptance Criteria:**
  - Given a tank is approved for posting (auto or supervisor), when the Variance Engine triggers posting, then a Material Document is created via the S/4HANA Material Documents OData API and the document number is written to the CAP audit log
  - Given a posting fails, when the API call returns an error, then the failure is logged, an URGENT alert is raised, and no retry is attempted without operator acknowledgement
- **Maps to Objective:** 1
- **Priority Rank:** 5

**R06: OK / FLAG / URGENT Alerting**
- **Problem to Solve:** Finance Accountants and Supervisors need real-time awareness of run outcomes without having to poll the dashboard.
- **User Story:** As a finance accountant, I need to receive a structured alert after each daily run classifying the overall outcome so that I can act immediately on any exception without waiting for an email.
- **Acceptance Criteria:**
  - Given a reconciliation run completes (fully or partially), when the Alert Manager fires, then an OK / FLAG / URGENT alert is delivered via SAP BTP Alert Notification Service to the Finance Accountant and Terminal Supervisor within 1 minute
  - Given a run contains at least one URGENT tank, when the alert is sent, then the alert body lists the affected tank IDs and delta values
- **Maps to Objective:** 3
- **Priority Rank:** 6

**R07: Per-Tank Variance PDF Report and Distribution**
- **Problem to Solve:** All roles need a consolidated, printable record of each day's reconciliation outcome for compliance and shift handover.
- **User Story:** As a terminal supervisor, I need a per-tank variance PDF to be automatically generated and delivered to Email and MS Teams after every completed run so that I have a permanent record for shift handover and compliance review.
- **Acceptance Criteria:**
  - Given a reconciliation run reaches the posting step, when the Report Generator runs, then a PDF is produced containing each tank's gauge reading, VCF-corrected volume, book stock, delta, classification, and posting status
  - Given the PDF is generated, when distribution runs, then it is sent to the configured Email recipients and posted to the MS Teams channel within 5 minutes of run completion
- **Maps to Objective:** 4
- **Priority Rank:** 7

**R08: Unified CAP Dashboard**
- **Problem to Solve:** All five user roles currently work across multiple SAP transactions and email threads with no single view of run status.
- **User Story:** As any operational role, I need a single web dashboard showing the live status of today's run and the history of all previous runs so that I never need to open multiple SAP transactions to understand the current inventory position.
- **Acceptance Criteria:**
  - Given the user is authenticated, when they open the CAP dashboard, then they see a live run pipeline (Ingestion → VCF → Variance → Approval → Posted) and per-tank status cards
  - Given the user selects a historical run, when the run detail opens, then they see the full audit trail including all classification decisions, approval actions, and posting outcomes
- **Maps to Objective:** 3, 5
- **Priority Rank:** 8

**R09: Immutable Audit Log**
- **Problem to Solve:** Custody transfer and regulatory compliance require a tamper-evident record of every measurement, correction, decision, and posting.
- **User Story:** As a compliance officer, I need every reconciliation action to be written to an immutable audit log so that I can reconstruct the full decision chain for any run during an audit.
- **Acceptance Criteria:**
  - Given any run step completes or fails, when the Alert Manager writes to the log, then the entry includes timestamp, actor (system or user ID), action type, input values, output values, and outcome
  - Given the audit log is queried, when a compliance officer filters by tank, date range, or classification, then results are returned within 5 seconds
- **Maps to Objective:** 5
- **Priority Rank:** 9

### High-Want Requirements

**R10: Configurable Tolerance Thresholds per Tank / Product**
- **Problem to Solve:** Different tanks hold different hydrocarbon products with different regulatory loss/gain allowances; a single global threshold is not operationally valid.
- **User Story:** As a stock controller, I need to configure OK / FLAG / URGENT thresholds per tank or per product type in the CAP admin screen so that the classification is meaningful for each tank's actual regulatory context.
- **Priority Rank:** 1

**R11: Run Re-trigger on Data Completeness Failure**
- **Problem to Solve:** ATG connectivity gaps or delayed Fiori submissions can cause incomplete ingestion; operators need a manual re-trigger without starting a full new run.
- **User Story:** As a stock controller, I need to manually re-trigger the Data Collector step for a specific run without reprocessing already-ingested tanks so that a connectivity blip does not require a full restart.
- **Priority Rank:** 2

### Nice-to-Have Requirements

**R12: Trend Visualisation — Tank Variance History**
- **Problem to Solve:** Repeated small variances on the same tank can indicate calibration drift or product loss that is not caught by daily tolerance checks.
- **User Story:** As a stock controller, I need a 30-day variance trend chart per tank in the dashboard so that I can spot emerging calibration or loss patterns before they become URGENT.
- **Priority Rank:** 1

**R13: Multi-Terminal Support**
- **Problem to Solve:** Organisations operating multiple terminals need to run the reconciliation agent per site from a single BTP deployment.
- **User Story:** As a system administrator, I need to configure the solution for multiple terminal locations so that the BTP deployment scales across the organisation without duplicating infrastructure.
- **Priority Rank:** 2

---

## Non-Functional Requirements

### Performance
- **Latency:** Full reconciliation run (ingestion through posting) completes within 15 minutes for up to 20 tanks
- **Dashboard response:** All dashboard views load within 3 seconds

### Reliability
- **Availability:** CAP dashboard — 99.5% uptime during operational hours (05:00–22:00 local terminal time)
- **Fallback:** If the VCF API is unavailable, the ASTM fallback table is used automatically; the fallback is flagged in the run log and the alert

### Explainability
- **Traceability:** Every VCF-corrected figure references its source tables (strapping calibration ID, temperature conversion factor used) in the audit log
- **Decision logging:** Classification outcome (OK / FLAG / URGENT) is logged with the threshold values active at the time of classification
- **Uncertainty communication:** If VCF fallback is used, the dashboard displays a warning indicator on the affected tank's result card

---

## Solution Architecture

**Architecture Overview:**
A scheduled n8n workflow on SAP BTP acts as the Reconciliation Agent, orchestrating five components per daily cycle. A CAP Node.js application provides the persistent data layer and REST APIs consumed by the React dashboard. All S/4HANA interactions use standard OData APIs. SAP BTP Alert Notification Service handles push delivery. MS Teams integration uses a webhook from the Report Generator.

**Key Components:**

| Component | Technology | Purpose |
|---|---|---|
| Scheduler | n8n Cron trigger | Fires the daily reconciliation run at configured time |
| Data Collector | n8n workflow node | Ingests ATG readings and Fiori dip entries; reads HPM book stock; validates completeness |
| VCF Calculator | n8n workflow node | Reads Strapping and VCF tables from HPM; converts Gross → Net via Hydrocarbon Qty Conversion API |
| Variance Engine | n8n workflow node | Computes per-tank delta; classifies OK/FLAG/URGENT; triggers auto-posting or approval hold |
| Alert Manager | n8n workflow node | Classifies run outcome; writes audit log entries; fires BTP Alert Notification Service |
| Report Generator | n8n workflow node | Generates per-tank variance PDF; distributes via Email and MS Teams webhook |
| CAP Backend | SAP CAP Node.js on BTP | Persistent store for runs, variances, approvals, audit log; REST APIs for dashboard and n8n |
| React Dashboard | React + SAP UI5 Web Components | Unified cockpit — live run status, approval queue, tank detail, historical audit |
| SAP BTP Alert Notification Service | SAP BTP managed service | Delivers OK/FLAG/URGENT push alerts to Finance Accountant and Supervisor |

**Integration Points:**

| System | Integration | Direction | Frequency |
|---|---|---|---|
| ATG System | File/API poll | Inbound to n8n | Daily, on scheduler trigger |
| S/4HANA — Fiori Ticket Data Capture | Physical Inventory OData (`API_PHYSICAL_INVENTORY_DOC_SRV`) | Inbound read | Daily |
| S/4HANA — HPM Balance Tables | Material Stock OData (`API_MATERIAL_STOCK_SRV`) | Inbound read | Daily |
| S/4HANA — Tank Master & Strapping | Measurement Document OData (`MEASUREMENTDOCUMENT_0001`) + RFC extension | Inbound read | Daily |
| S/4HANA — Hydrocarbon Qty Conversion | REST API (no ORD ID; ASTM fallback in CAP) | Inbound read | Per VCF calculation |
| S/4HANA — Goods Movement Posting | Material Document OData (`API_MATERIAL_DOCUMENT_SRV`) | Outbound write | Per approved tank |
| SAP BTP Alert Notification Service | BTP managed service API | Outbound | Per run completion |
| MS Teams | Webhook | Outbound | Per run completion |
| Email | SMTP / BTP mail service | Outbound | Per run completion |

**Deployment Environments:**

- **Dev:** BTP trial / sandbox; S/4HANA sandbox with HPM test data
- **QA:** BTP non-prod; S/4HANA QA client; test ATG simulator
- **Prod:** BTP prod space; S/4HANA Cloud Private Edition production client

### Automation & Agent Behaviour

**Automation Level:** Rule-based workflow with configurable thresholds

**Actions the system performs without human approval:**
- Ingest ATG and Fiori readings and merge into a single dataset
- Apply VCF correction using HPM conversion tables
- Classify each tank as OK / FLAG / URGENT
- Post goods movements for OK and FLAG tanks
- Write all steps to the audit log
- Generate and distribute the variance PDF
- Deliver alerts via BTP Alert Notification Service

**Actions that require human review or approval:**
- Goods movement posting for URGENT-classified tanks — Terminal Supervisor must explicitly approve or reject via the CAP dashboard

**Model or engine used:** Configurable rule engine (threshold configuration stored in CAP); no LLM involved

**Knowledge and data sources accessed:**
- ATG system (gauge readings — external, polled by n8n)
- S/4HANA HPM Balance Tables (book stock — authoritative)
- S/4HANA Tank Master Data (capacity, heel thresholds)
- S/4HANA Tank Strapping Calibration Tables (dip-to-volume)
- S/4HANA VCF / Qty Conversion Tables (temperature correction factors)
- CAP configuration (tolerance thresholds, recipient lists)
- CAP audit log (immutable run history)

**Tools / connectors invoked:**

| Tool / Connector | Purpose | Risk level |
|---|---|---|
| `API_PHYSICAL_INVENTORY_DOC_SRV` | Read Fiori dip entries | Read-only |
| `API_MATERIAL_STOCK_SRV` | Read HPM book stock | Read-only |
| `MEASUREMENTDOCUMENT_0001` | Read tank master and strapping data | Read-only |
| Hydrocarbon Qty Conversion REST API | Apply VCF correction | Read-only |
| `API_MATERIAL_DOCUMENT_SRV` | Post goods movements (shrinkage/gain) | **Write — high risk** |
| BTP Alert Notification Service | Deliver run alerts | Write |
| MS Teams webhook | Distribute PDF report | Write |

**Guardrails & fail-safes:**
- Goods movements for URGENT tanks are never posted without an explicit supervisor approval record in CAP
- If the Data Collector detects incomplete ingestion (missing tanks or null readings), the run halts before VCF calculation and an URGENT alert is raised
- If the Material Document API call fails, no retry is attempted automatically; the failure is logged and an URGENT alert is raised for operator acknowledgement
- VCF API fallback: if the SAP Hydrocarbon Quantity Conversion API is unavailable, the ASTM correction table in CAP is used and the fallback is flagged in the audit log and on the dashboard

---

## Milestones

### M1: Data Ingested
- **Description:** ATG and Fiori dip readings have been received and validated for completeness; HPM book stock has been read
- **Achieved when:** All configured tanks have a gauge reading and a corresponding HPM book stock figure loaded into the run record
- **Log on achievement:** `M1.achieved: data ingestion complete — {tank_count} tanks loaded, sources: ATG={atg_count}, Fiori={fiori_count}`
- **Log on miss:** `M1.missed: data ingestion incomplete — missing readings for tanks: {tank_ids}; run halted`

### M2: VCF Correction Applied
- **Description:** Gross observed volumes have been converted to net standard volumes for all tanks using HPM strapping and conversion tables
- **Achieved when:** Every tank in the run has a VCF-corrected net volume recorded, with the correction factor and source table referenced
- **Log on achievement:** `M2.achieved: VCF correction complete — {tank_count} tanks corrected; fallback_used={true|false}`
- **Log on miss:** `M2.missed: VCF correction failed for tanks: {tank_ids}; reason: {error_message}`

### M3: Variance Calculated and Classified
- **Description:** Per-tank deltas computed and each tank classified as OK / FLAG / URGENT
- **Achieved when:** Every tank has a delta value and a classification written to the run record
- **Log on achievement:** `M3.achieved: variance classification complete — OK={ok_count}, FLAG={flag_count}, URGENT={urgent_count}`
- **Log on miss:** `M3.missed: variance calculation failed — {error_message}`

### M4: Approval Decision Made
- **Description:** Terminal Supervisor has reviewed all URGENT tanks and submitted an approval or rejection for each
- **Achieved when:** Zero URGENT tanks remain in pending-approval state
- **Log on achievement:** `M4.achieved: all URGENT variances resolved — approved={approved_count}, rejected={rejected_count}, approver={user_id}`
- **Log on miss:** `M4.missed: approval pending for tanks: {tank_ids} — supervisor action required`

### M5: Goods Movements Posted
- **Description:** Material Documents have been created in S/4HANA for all approved tanks
- **Achieved when:** Every approved tank has a Material Document number recorded in the CAP audit log
- **Log on achievement:** `M5.achieved: goods movements posted — {posted_count} documents created; material_doc_ids: {doc_ids}`
- **Log on miss:** `M5.missed: posting failed for tanks: {tank_ids}; reason: {error_message}`

### M6: Report Distributed
- **Description:** Per-tank variance PDF has been generated and sent to Email and MS Teams
- **Achieved when:** PDF generation succeeds and delivery confirmation is received from both channels
- **Log on achievement:** `M6.achieved: reconciliation report distributed — recipients: {email_count} email, Teams channel: {channel_name}`
- **Log on miss:** `M6.missed: report distribution failed — channel: {channel}; reason: {error_message}`

---

## Risks, Assumptions, and Dependencies

### Risks

- **Tank Strapping Table OData coverage (High):** Standard OData may not fully expose strapping calibration tables in S/4HANA Cloud Private Edition — an RFC or BAPI extension may be required. Must be validated in Sprint 1.
- **ATG protocol variability (Medium):** ATG systems differ by vendor in payload format and transport protocol; the Data Collector normalisation layer must be designed for pluggability.
- **VCF REST API stability (Medium):** The Hydrocarbon Quantity Conversion REST API has limited public documentation; ASTM fallback must be operational from day one.
- **S/4HANA authorisation provisioning (Medium):** Material Document posting and physical inventory OData calls require specific authorisation profiles — must be provisioned and tested before UAT.

### Assumptions

- S/4HANA Cloud Private Edition is the live system of record for HPM book stock, tank master data, and goods movement postings
- The Fiori Mobile Ticket Data Capture app is already deployed and operational in the terminal environment
- A BTP subaccount with Alert Notification Service entitlement and an n8n runtime is available
- MS Teams channel and Email recipient lists are known and stable at the time of configuration
- Tolerance thresholds (OK / FLAG / URGENT) will be provided by the terminal operations team during configuration

### Dependencies

- SAP S/4HANA Cloud Private Edition — IS-OIL HPM active and accessible via OData from BTP
- SAP BTP subaccount with: CAP runtime, n8n, Alert Notification Service, connectivity to S/4HANA
- ATG system vendor API or file export available at a known endpoint or SFTP location
- Fiori Mobile Ticket Data Capture app writing physical inventory documents to S/4HANA

---

## Appendix

### Glossary

| Term | Definition |
|---|---|
| ATG | Automatic Tank Gauging — electronic system providing continuous tank level measurements |
| VCF | Volume Correction Factor — temperature/density multiplier converting gross observed volume to net standard volume |
| HPM | Hydrocarbon Product Management — SAP IS-OIL component managing hydrocarbon-specific inventory, qualities, and conversions |
| Gross Volume | Observed volume at actual temperature and pressure |
| Net Volume | Volume corrected to standard reference conditions (typically 15°C / 60°F) |
| Tank Strapping | Calibration table mapping dip/ullage readings to tank volumes |
| Goods Movement | S/4HANA inventory transaction creating a Material Document to record stock change (gain or shrinkage) |
| URGENT | Variance classification indicating delta exceeds primary tolerance threshold — requires supervisor approval before posting |
| FLAG | Variance classification indicating delta exceeds secondary threshold — auto-posted with supervisor notification |
| OK | Variance classification indicating delta is within tolerance — auto-posted without notification |

### References

- SAP S/4HANA IS-OIL Tank Management scope item 833 — Storage Tank Management
- SAP API Hub: Physical Inventory Documents (`API_PHYSICAL_INVENTORY_DOC_SRV`)
- SAP API Hub: Material Documents (`API_MATERIAL_DOCUMENT_SRV`)
- SAP API Hub: Material Stock (`API_MATERIAL_STOCK_SRV`)
- SAP API Hub: Measurement Document (`MEASUREMENTDOCUMENT_0001`)
- SAP BTP Alert Notification Service documentation
- ASTM D1250 — Standard Guide for Use of the Petroleum Measurement Tables
