# End-to-End Workflow — User Actions & What Happens Behind the Scenes

---

## Step 1 — Trigger a Reconciliation Run

**User Action:**
> Open the dashboard → select today's date → click **⚡ Trigger Run**

**What happens in the background:**
- CAP checks for any AMBER tanks older than 8 hours from previous runs and auto-posts them first
- CAP creates a new `ReconciliationRun` record with status `PENDING`
- For each active tank, CAP calls `ZTANK_DIP_SRV_SRV` in OGS/650 via Cloud Connector
- OGS reads the latest tank dip from `OIB_TANKDIP` (IS-OIL table) returning:
  - `QUAN_SKU` = **physical quantity** measured by the ATG gauge
  - `RELSTOCK` = **book stock** (SAP system records) at time of dip
- M1 audit entry written with timestamp and AI input validation checks
- VCF correction applied (factor 1.0 — QUAN_SKU already VCF-corrected by IS-OIL), M2 audit written
- Delta computed: **Physical (QUAN_SKU) − Book Stock (RELSTOCK)**
- Each tank classified against configured tolerances:
  - 🟢 **GREEN** → delta ≤ 0.50% — auto-posts immediately
  - 🟡 **AMBER** → delta 0.50%–2.00% — auto-posts, or after 8 hours on next run
  - 🔴 **RED** → delta > 2.00% — held for supervisor approval
- M3 audit entry written per tank including **AI Recommendation** for classification
- GREEN/AMBER tanks automatically post via `ZTANK_POST_SRV_SRV` in OGS/650 (M5)
- Run status updates to `COMPLETED`
- M6 audit entry written, Teams/ANS notification sent

---

## Step 2 — Check the Dashboard

**User Action:**
> Look at the dashboard — notice the 🔔 bell icon shows a red badge

**What happens in the background:**
- Dashboard shows the new run in the table sorted by trigger time (latest first)
- KPI tiles update: Total Runs, Urgent Variances count, Awaiting Approval count
- Notification bell shows unread count
- A webhook notification was automatically sent to the configured endpoint with run summary (🔴 RED / 🟡 AMBER / 🟢 GREEN)

**User Action:**
> Click the 🔔 bell icon

- Panel opens showing run summary: date, status, tank counts
- If RED tanks exist → warning shown: *"Approval required for X tanks"*

---

## Step 3 — Review Tank Details

**User Action:**
> Click **View** on the run row → click **← Dashboard** to go back

**What happens in the background:**
- CAP fetches `TankResults` for that run from SQLite
- Shows per-tank breakdown: Book Stock, Physical Qty, Dip Date/Time, Delta, Delta%, Classification, Posting Status

**What the user sees:**
- Each tank row with its live IS-OIL data
- **Dip Date/Time** column showing when the ATG measurement was taken
- RED tanks highlighted in red
- Posted tanks show a **📄 clickable material document link** (opens MIGO in OGS/650 Fiori)
- Audit log tab showing M1 → M2 → M3 → M4 → M5 → M6 milestones with **AI Recommendations in bold**

---

## Step 4 — Go to Approval Queue

**User Action:**
> Click **✅ Approval Queue** in the left sidebar

> ⚠️ *This page is visible only to users with the Supervisor or Admin role*

**What happens in the background:**
- CAP queries all `TankResults` where `classification = RED` and `postingStatus = PENDING`
- Open TSW nominations fetched from OGS/650 via `NominationSet` in `ZTANK_DIP_SRV_SRV`
- Only tanks waiting for human approval are shown

**What the user sees:**
- List of RED tanks with their delta values, run date, tank name
- **Review** button for each tank
- On clicking Review: tank details, **Reason Code dropdown** (loaded dynamically from T157D), comment field, **Open TSW Nominations** panel showing pending product movements

---

## Step 5 — Approve or Reject

**User Action (Approve):**
> Click **Review** on a tank → **select a Reason Code (mandatory)** → optionally enter a comment → click **✓ Approve**

**What happens in the background:**
- CAP validates reason code is selected (mandatory for RED approval)
- CAP creates an `ApprovalRecord` with decision `APPROVED`, actor (user ID), timestamp, reason code, comment
- M4 audit entry written including: **Reason Code, Comment, AI Info** (goods movement posting will now be attempted)
- CAP attempts goods movement posting via `ZTANK_POST_SRV_SRV` in OGS/650 (M5):
  - Physical Inventory document created (`BAPI_MATPHYSINV_CREATE`)
  - Count recorded using dip timestamp as count date (`BAPI_MATPHYSINV_COUNT`)
  - Differences posted as 701 (gain) or 702 (loss) (`BAPI_MATPHYSINV_POSTDIFF`)
- If posting succeeds → `postingStatus = POSTED`, Material Document ID written back, clickable link shown
- If posting fails → `postingStatus = FAILED`, **AI Recommendation written to M5 audit** explaining what to do

**User Action (Reject):**
> Click **Review** → enter mandatory rejection comment → click **✗ Reject**

**What happens in the background:**
- `ApprovalRecord` created with decision `REJECTED`
- `postingStatus = REJECTED`, rejection reason stored
- M4 audit entry written with reason code and **AI Info**
- No goods movement is posted

---

## Step 6 — Check the Audit Trail

**User Action:**
> Click **📋 Audit Trail** in the left sidebar → use **Date From/To filters** to narrow results

**What the user sees:**
```
29/07/2026 10:00  M1  INGEST    –         ACHIEVED   M1.trigger: run initiated for 2026-07-29 at 10:00:00
29/07/2026 10:00  M2  VCF       Tank-001  ACHIEVED   M2.vcf: Physical quantity is 1757.506 TO (ATG measurement)...
29/07/2026 10:00  M3  VARIANCE  Tank-001  ACHIEVED   M3.variance: bookStock=140720 netPhysical=1757 delta=-138963...
                                                      AI Recommendation: Variance of 98.75% exceeds RED threshold...
29/07/2026 10:00  M6  REPORT    –         ACHIEVED   M6.complete: 2 tanks, alerts sent
29/07/2026 10:05  M4  APPROVAL  Tank-001  ACHIEVED   M4.achieved: RED variance approved | Reason Code: 0002 | Comment: ...
                                                      AI Info: Approval recorded. Goods movement posting will now be attempted.
29/07/2026 10:05  M5  POSTING   Tank-001  POST FAIL  M5.failed: ... Physical=1757 BookStock=140720 Delta=-138963...
                                                      AI Recommendation: Contact terminal operator to verify physical reading...
```

**What happens in the background:**
- Every action, decision, and system event is permanently recorded
- Tamper-evident — entries cannot be modified
- Full traceability from raw dip reading to final posting decision
- **AI Recommendations displayed in bold** on new lines for easy reading

---

## AMBER Auto-Post — 8 Hour Rule

If a tank is classified as AMBER and has not been manually actioned within **8 hours** of the run completing, the system automatically posts the goods movement the **next time a new run is triggered** — using the OGS_S4 destination via Cloud Connector.

---

## Summary Flow Diagram

```
User triggers run
      ↓
[BTP CAP] checks AMBER tanks > 8 hours → auto-posts via OGS_S4
      ↓
[BTP CAP] creates new run
      ↓
[OGS/650] reads OIB_TANKDIP via Cloud Connector (QUAN_SKU=physical, RELSTOCK=book stock)
      ↓
[BTP CAP] computes delta, classifies tanks GREEN/AMBER/RED
      ↓
GREEN/AMBER → auto-posts via ZTANK_POST_SRV_SRV
RED → held in Approval Queue
      ↓
[Webhook] M6 alert sent 🔴🟡🟢
      ↓
Bell 🔔 shows notification count
      ↓
Supervisor opens Approval Queue → sees tank details + open TSW nominations
      ↓
Supervisor selects reason code (mandatory) + approves/rejects RED tanks
      ↓
[OGS/650] goods movement posting attempted via BAPI_MATPHYSINV_POSTDIFF
      ↓
Material document created → clickable link in Run Detail
      ↓
Audit Trail shows complete M1→M6 history with AI Recommendations
```
