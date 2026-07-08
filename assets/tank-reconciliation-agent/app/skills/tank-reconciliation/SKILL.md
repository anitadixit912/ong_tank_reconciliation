---
name: tank-reconciliation
description: Domain knowledge for hydrocarbon tank stock reconciliation — variance thresholds, VCF correction, ATG/manual dip reconciliation, and S/4HANA goods movement posting rules.
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
