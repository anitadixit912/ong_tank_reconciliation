# Hydrocarbon Tank Reconciliation — E2E Daily Workflow

Daily end-to-end tank stock reconciliation for hydrocarbon operations — from dual-source field measurement ingestion (ATG + Fiori manual dip) through VCF correction, variance analysis, goods movement posting, alerting, and PDF report distribution — orchestrated by a BTP Reconciliation Agent and surfaced in a unified CAP dashboard.

## Business challenge

Hydrocarbon terminals receive physical stock measurements from two sources: continuous electronic readings from Automatic Tank Gauging (ATG) systems and manual dip entries by terminal operators via the Fiori Mobile Ticket Data Capture app. Today these readings must be manually matched against HPM book stock, VCF-corrected using tank strapping calibration and temperature/quantity conversion tables, variance-analysed per tank, and posted as goods movements in S/4HANA — a fragmented, error-prone, and audit-heavy process. The goal is a fully automated daily reconciliation pipeline with intelligent alerting, PDF report distribution, and a single cockpit for all operational roles.

## Solution Architecture — Layer Details

### Layer 1 — Field / Terminal
| Source | Method |
|---|---|
| **Terminal Operator** | Manual dip entry via Fiori Mobile Ticket Data Capture app |
| **ATG (Automatic Tank Gauge)** | Continuous electronic readings, no manual intervention |
| **Scheduler** | Triggers daily reconciliation run at a configured time |

### Layer 2 — Reconciliation Agent (SAP BTP)
Five orchestrated components running as an n8n workflow on BTP:

| Component | Responsibility |
|---|---|
| **Data Collector** | Ingests HPM book stock and field readings (ATG + manual); validates completeness |
| **VCF Calculator** | Applies Volume Correction Factor and Material Temperature for Gross → Net volume conversion |
| **Variance Engine** | Computes delta per tank; applies tolerance thresholds; triggers goods movement posting |
| **Alert Manager** | Classifies each tank as OK / FLAG / URGENT; writes to reconciliation log audit trail |
| **Report Generator** | Builds per-tank variance PDF; distributes via Email and MS Teams channel |

### Layer 3 — SAP IS-OIL HPM Data Stores
| Data Store | Used by |
|---|---|
| **HPM Balance Tables** | Book stock per tank — read by Data Collector |
| **Tank Master Data** | Capacity, safety levels, minimum heel thresholds — read for tolerance context |
| **Tank Strapping Calibration Tables** | Dip-to-volume conversion — read by VCF Calculator |
| **VCF / Qty Conversion Tables** | Temperature correction factors — read by VCF Calculator |
| **Goods Movement Posting** | Receives shrinkage/gain write from Variance Engine (Goods Movement, Stock Reconciliation, Financial Postings) |

### Layer 4 — Notification & Recipients
| Channel | Recipients |
|---|---|
| **SAP BTP Alert Notification Service** | Finance Accountant, Terminal Supervisor — OK / FLAG / URGENT alerts |
| **Email / MS Teams Channel** | All roles — consolidated reconciliation report after every run |

## Key Milestones

1. **Data Ingested** — ATG and manual Fiori dip readings received and validated for completeness
2. **VCF Correction Applied** — Gross observed volumes converted to Net standard volumes using tank strapping and temperature correction tables
3. **Variance Calculated** — Physical (net corrected) stock compared against HPM book stock per tank; OK / FLAG / URGENT classification applied
4. **Approval Decision Made** — Supervisor reviews URGENT-flagged tanks and approves or rejects the run via CAP dashboard
5. **Goods Movement Posted** — HPM inventory adjustment posted to S/4HANA; shrinkage/gain written; audit record closed
6. **Report Distributed** — Per-tank variance PDF generated and sent to Email / MS Teams; alerts fired via BTP Alert Notification Service

## Business Architecture (RBA)

### End-to-End Process

Hydrocarbon Supply and Refining

### Process Hierarchy

```
Hydrocarbon Supply and Refining
└── Deliver Product to Fulfill (hydrocarbon supply and distribution)
    └── Manage hydrocarbon logistics and inventory (BPS-348_007)
        └── Manage tanks
        └── Manage terminal logistics
    └── Manage hydrocarbon supply and primary distribution (BPS-355_001)
        └── Balance inventory
        └── Manage Ticket
└── Make to Inspect (hydrocarbon refining)
    └── Operate hydrocarbon refining (BPS-347_006)
        └── Confirm continuous production
└── Plan to Optimize Fulfillment
    └── Plan inventory and supply — hydrocarbon (BPS-339_008)
        └── Define refinery planning parameters
```

### Summary

The challenge maps directly to the Hydrocarbon Supply and Refining E2E, primarily BPS-348_007 (tank logistics, physical inventory, VCF conversion, stock reconciliation) and BPS-355_001 (inventory balancing and goods movement/ticket management), with BPS-339_008 covering variance tolerance and approval governance.

## Fit Gap Analysis

| Requirement (business) | Standard asset(s) found | API ORD ID | MCP Server ORD ID | MCP Server Version | Gap? | Notes / assumptions |
|---|---|---|---|---|---|---|
| Ingest ATG gauge readings | Physical Inventory Management for Hydrocarbons (SC5303) | `sap.s4:apiResource:MEASUREMENTDOCUMENT_0001:v1` | — | — | No | Measurement Document API; n8n polls ATG endpoint |
| Ingest manual Fiori dip readings | Ticket Management (SC5313), Physical Inventory (SC5303) | `sap.s4:apiResource:API_PHYSICAL_INVENTORY_DOC_SRV:v1` | — | — | No | Fiori Mobile Ticket Data Capture writes to S/4HANA; Data Collector reads back |
| Read HPM book stock (Balance Tables) | Stock Reconciliation (SC5299) | `sap.s4:apiResource:API_MATERIAL_STOCK_SRV:v1` | — | — | No | Material Stock Read OData provides authoritative book stock |
| Read Tank Master Data & Strapping Tables | Physical Inventory Mgmt for Hydrocarbons (SC5303) | `sap.s4:apiResource:MEASUREMENTDOCUMENT_0001:v1` | — | — | Maybe | Tank master/strapping readable via HPM APIs; may require RFC extension for strapping tables |
| VCF / Quantity conversion (Gross → Net) | Hydrocarbon Quantity Conversion (SC5281) | Hydrocarbon Quantity Conversion REST API (no ORD ID) | — | — | Maybe | Native S/4 HPM conversion; REST API available — no MCP server; fallback: ASTM table logic in CAP |
| Per-tank variance computation | Stock Reconciliation (SC5299) | `sap.s4:apiResource:API_MATERIAL_STOCK_SRV:v1` | — | — | No | Delta logic implemented in n8n Variance Engine node |
| OK / FLAG / URGENT classification | — | — | — | — | Yes | No standard classification API — Alert Manager component in n8n with configurable thresholds |
| Hold URGENT postings for supervisor approval | Internal Goods Movement (SC5484) | — | — | — | Yes | CAP approval state machine gates posting; no native S/4HANA hold API |
| HPM goods movement posting (shrinkage/gain) | Goods Issue/Receipt, Internal Goods Movement (SC5484 / SC5465 / SC5468) | `sap.s4:apiResource:API_MATERIAL_DOCUMENT_SRV:v1` | — | — | No | Material Document Create API; posts after approval |
| Audit trail per reconciliation run | Stock Reconciliation (SC5299), Material Document confirmation | `sap.s4:apiResource:OP_CO_MMIM_SOA_MATDOC_CONF_V2:v2` | — | — | No | CAP persists full run history; confirmation event closes record |
| OK/FLAG/URGENT alerts to Finance & Supervisor | — | BTP Alert Notification Service | — | — | Yes | SAP BTP Alert Notification Service covers this natively; no S/4 API gap |
| Per-tank variance PDF + Email/Teams distribution | — | — | — | — | Yes | Report Generator in n8n: PDF generation + Email node + MS Teams webhook |
| Unified dashboard (all roles) | — | — | — | — | Yes | CAP + React dashboard — no standard BTP app covers this combined view |

### Key findings

- **S/4HANA Cloud Private Edition** carries all mandatory hydrocarbon capabilities: SC5281 VCF, SC5303 physical inventory, SC5299 stock reconciliation, SC5313 ticket management, SC5484 goods movement.
- **Dual field input sources** (ATG continuous + Fiori manual dip) require the Data Collector to merge and validate two distinct ingestion paths before VCF calculation.
- **Tank Strapping Calibration Tables** may need an RFC/BAPI extension — standard OData coverage is partial; this is the highest-risk integration point.
- **No MCP servers** exist for any discovered OData APIs — all S/4HANA calls use direct OData/REST from n8n, which is fully viable.
- **BTP Alert Notification Service** covers the OK/FLAG/URGENT alert delivery natively — no custom notification infrastructure needed.
- **Report Generator** (PDF + Email + MS Teams) is a custom n8n component; no standard SAP asset covers consolidated PDF distribution to Teams channels.

## Recommendations

### Hydrocarbon Tank Reconciliation — BTP Reconciliation Agent + CAP Dashboard

#### Executive Summary

Five-component BTP Reconciliation Agent (n8n) with CAP cockpit, HPM integration, and multi-channel alerting.

#### Recommended Solution

A scheduled n8n workflow on SAP BTP acts as the Reconciliation Agent, running five sequenced components per daily cycle: (1) **Data Collector** merges ATG electronic readings and Fiori manual dip entries, reads HPM Balance Tables via OData, and validates completeness; (2) **VCF Calculator** reads Tank Strapping Calibration and VCF/Qty Conversion Tables from HPM to convert gross observed volumes to net standard volumes; (3) **Variance Engine** computes per-tank deltas, applies configurable tolerance thresholds, and triggers goods movement posting for auto-approved tanks; (4) **Alert Manager** classifies each result as OK / FLAG / URGENT and writes every decision to the CAP reconciliation audit log; (5) **Report Generator** produces a per-tank variance PDF and distributes it via Email and MS Teams webhook. URGENT variances are held — the CAP dashboard presents them to the Terminal Supervisor for explicit approval before the Material Document posting fires. SAP BTP Alert Notification Service delivers real-time OK/FLAG/URGENT push alerts to Finance Accountants and Supervisors. The CAP application is the persistent backbone (runs, variance records, approval state, audit history) and the React dashboard is the single cockpit for all roles.

#### Affected User Roles

- **Terminal Operator** — enters manual dip readings via Fiori Mobile Ticket Data Capture app
- **Stock Controller / Inventory Analyst** — monitors daily run progress and per-tank variance detail in the CAP dashboard
- **Terminal Supervisor** — reviews URGENT-flagged tanks; approves or rejects goods movement posting
- **Finance Accountant** — receives OK/FLAG/URGENT alerts; accesses audit trail and financial postings
- **Compliance Officer** — reviews historical reconciliation reports and audit records

#### Important factors

##### Full automation from gauge to ledger
The entire chain — from field measurement receipt through VCF conversion, variance classification, approval, and goods movement posting — is automated; human involvement is limited to URGENT exceptions.

##### Dual-source data integrity
ATG continuous readings and Fiori manual dip entries are merged and cross-validated in the Data Collector step, preventing incomplete or duplicate reconciliation runs.

##### Configurable tolerance tiers
OK / FLAG / URGENT thresholds are stored in CAP configuration, not hardcoded — terminals with different product types or regulatory requirements can be tuned independently.

##### Native BTP alerting
SAP BTP Alert Notification Service handles push delivery without custom infrastructure, reducing operational overhead.

#### Potential risks

##### Tank Strapping Table access
Standard OData may not fully expose strapping/calibration tables — an RFC or BAPI extension in S/4HANA Cloud Private Edition may be required. This should be validated in the first sprint.

##### ATG protocol variability
ATG vendors differ in payload format; the Data Collector normalisation layer must be designed for pluggability to accommodate multi-site rollout.

##### VCF REST API stability
The Hydrocarbon Quantity Conversion REST API has limited public documentation; a CAP-hosted ASTM fallback table should be implemented as a safety net from day one.

##### S/4HANA authorisation provisioning
Material Document posting and physical inventory OData calls require specific authorisation profiles in S/4HANA Cloud Private Edition — these must be provisioned and tested before UAT.

#### Recommended solution category

n8n Workflow, BTP Extension

#### Intent fit
93%
