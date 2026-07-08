# Specification — Hydrocarbon Tank Reconciliation E2E

> **Guidelines**: Read [guidelines.md](./guidelines.md) before executing ANY tasks below.

Check off items as completed.

## Solution Setup

- [ ] Create asset directories:
  ```
  mkdir -p assets/tank-reconciliation-cap
  mkdir -p assets/n8n/workflows
  ```
- [ ] Invoke `setup-solution` skill to create `solution.yaml` and `asset.yaml` files for both assets:
  - `assets/tank-reconciliation-cap/asset.yaml` — type: `cap-app`
  - `assets/n8n/asset.yaml` — type: `n8n-workflow`
- [ ] Validate both `asset.yaml` files exist and are well-formed

## Asset Implementation

> **Order is mandatory**: CAP must be fully implemented before the n8n workflow, because n8n calls CAP REST endpoints at runtime.

- [ ] Execute `specification/tank-reconciliation-cap/specification.md` (all items)
- [ ] Execute `specification/n8n/specification.md` (all items)

## Cross-Asset Compatibility Check

- [ ] Verify the CAP endpoint `POST /odata/v4/ReconciliationService/triggerRun` is reachable and returns a `runId`
- [ ] Verify the CAP endpoint `POST /odata/v4/ReconciliationService/AuditLog` accepts the milestone log payload shape used by n8n nodes
- [ ] Verify the CAP approval callback webhook path `/tank-reconciliation/approval-callback` matches the n8n Webhook Wait node path
- [ ] Verify the `TankResult` batch upsert payload shape from n8n matches the CAP entity definition
- [ ] Confirm all n8n placeholder URLs (`CAP_BASE_URL`, `S4_BASE_URL`, `ATG_BASE_URL`, etc.) are documented in the n8n workflow comment node
- [ ] Confirm no credentials or auth tokens are hardcoded in either asset

## Solution Architecture Summary

```
[ATG System]──────────────────────────────────────────────────┐
[Fiori Mobile Ticket Data Capture] ──→ [S/4HANA HPM] ─────────┤
[Scheduler / CAP Dashboard Trigger] ──→ [n8n Reconciliation Agent (BTP)]
                                              │
                              ┌───────────────┴───────────────┐
                        [Data Collector]             [Variance Engine]
                        [VCF Calculator]             [Alert Manager]
                              │                      [Report Generator]
                              ▼
                    [CAP Backend (BTP)]
                    ├── ReconciliationRun
                    ├── TankResult
                    ├── ApprovalRecord
                    ├── AuditLog
                    └── TankConfiguration
                              │
              ┌───────────────┼───────────────┐
       [React Dashboard]  [S/4HANA Mat.Doc]  [BTP Alert ANS]
       (all 5 roles)      (Goods Movement)   [Email / MS Teams]
```

## API Reference (S/4HANA OData — consumed by n8n)

| API | ORD ID | Base Path | Used for |
|---|---|---|---|
| Material Documents — Read, Create | `sap.s4:apiResource:API_MATERIAL_DOCUMENT_SRV:v1` | `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV` | Post goods movements (shrinkage/gain) |
| Material Stock — Read | `sap.s4:apiResource:API_MATERIAL_STOCK_SRV:v1` | `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV` | Read HPM book stock per tank |
| Physical Inventory Documents | `sap.s4:apiResource:API_PHYSICAL_INVENTORY_DOC_SRV:v1` | `/sap/opu/odata/sap/API_PHYSICAL_INVENTORY_DOC_SRV` | Read Fiori manual dip entries |
| Measurement Document | `sap.s4:apiResource:MEASUREMENTDOCUMENT_0001:v1` | `/sap/opu/odata/sap/API_MEASUREMENTDOCUMENT_0001` | Read ATG readings, tank strapping data |
| Hydrocarbon Qty Conversion | REST (no ORD ID) | `/api/hydrocarbon-quantity-conversion/v1/convert` | Apply VCF (Gross → Net); ASTM fallback in CAP if unavailable |
