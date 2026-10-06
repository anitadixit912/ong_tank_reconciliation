---
name: tank-reconciliation
description: Domain knowledge for hydrocarbon tank stock reconciliation — variance thresholds, VCF correction, ATG/manual dip reconciliation, dip reading creation, and S/4HANA goods movement posting rules.
---

# Tank Reconciliation Domain Skill

## Variance Classification
- **OK**: variance ≤ configured threshold (default 0.5%)
- **FLAG**: variance between OK threshold and URGENT threshold (default 1.0%)
- **URGENT**: variance exceeds URGENT threshold — requires supervisor approval before goods movement posting

## VCF Temperature Correction
Volume Correction Factor applied per ASTM D1250 tables. ATG readings are corrected to 15°C base temperature.

## Goods Movement Types (S/4HANA)
- Movement Type 551: Shrinkage (stock loss)
- Movement Type 552: Gain (stock surplus)

## Approval Workflow
URGENT variances are held in CAP approval queue. Supervisor must approve/reject via `/reconciliation/approvePosting` before n8n posts to S/4HANA.

## Dip Reading Management (Tools Available)

| Tool | Purpose |
|---|---|
| `get_tank_configurations` | List all tanks with SOCNR, plant, tolerance thresholds |
| `list_dip_readings` | Recent dip readings for a tank from CAP DB |
| `create_dip_reading` | Create new dip reading in CAP (DRAFT status) |
| `post_dip_to_sap` | Submit CAP dip reading to SAP IS-Oil via OGS_S4 |
| `trigger_reconciliation_run` | Trigger M1-M6 reconciliation pipeline |

### Autonomous Dip-to-Reconciliation Pipeline
1. `get_tank_configurations` → find tankId (20-char SOCNR)
2. `create_dip_reading(tankId, date, dipType, value, unit, temp, density)` → returns dipReadingId
3. `post_dip_to_sap(dipReadingId)` → submits to IS-Oil; possible outcomes:
   - POSTED: written to OIB_TANKDIP in IS-Oil
   - FAILED: OGS error (inspect message)
   - PENDING_ABAP: CREATE not supported on ZTANK_DIP_SRV_SRV — record safe in CAP
4. `trigger_reconciliation_run(runDate, plant)` → runs full M1-M6 pipeline

### Dip Parameters
- **dipType**: I = Innage (depth from bottom) | U = Ullage (empty space from top)
- **dipUnit**: MM | CM | L | HL | BBL | M3
- **tankId**: zero-padded 20-char SOCNR (e.g. 00000000000000000023)
- **temperature**: degrees Celsius — used for ASTM D1250 VCF correction
- **density**: kg/m³ — used for ASTM D1250 VCF correction

