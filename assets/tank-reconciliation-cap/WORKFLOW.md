# End-to-End Workflow — User Actions & What Happens Behind the Scenes

---

## Step 1 — Trigger a Reconciliation Run

**User Action:**
> Open the dashboard → select today's date → click **⚡ Trigger Run**

**What happens in the background:**
- CAP creates a new `ReconciliationRun` record with status `PENDING`
- For each active tank, CAP calls `ZTANK_DIP_SRV_SRV` in OGS/650 via Cloud Connector
- OGS reads the latest tank dip from `OIB_TANKDIP` (IS-OIL table) returning:
  - `QUAN_SKU` = physical quantity measured by the operator
  - `RELSTOCK` = book stock at time of dip
- Delta is computed: **Physical − Book Stock**
- Each tank is classified against configured tolerances:
  - **OK** → delta ≤ 0.08%
  - **FLAG** → delta between 0.08% and 0.20%
  - **URGENT** → delta > 0.20%
- Run status updates to `COMPLETED`
- M1, M3, M6 audit entries written with timestamps

---

## Step 2 — Check the Dashboard

**User Action:**
> Look at the dashboard — notice the 🔔 bell icon shows a red badge

**What happens in the background:**
- Dashboard auto-refreshes and shows the new run in the table
- KPI tiles update: Total Runs, Urgent Variances count
- Notification bell queries the latest completed runs and shows unread count
- A webhook notification was automatically sent to the configured endpoint with run summary (🔴 URGENT / 🟡 FLAG / 🟢 OK)

**User Action:**
> Click the 🔔 bell icon

- Panel opens showing run summary: date, status, tank counts
- If URGENT tanks exist → warning shown: *"Approval required for X tanks"*

---

## Step 3 — Review Tank Details

**User Action:**
> Click **View** on the run row in the dashboard table

**What happens in the background:**
- CAP fetches `TankResults` for that run from SQLite
- Shows per-tank breakdown: Book Stock, Physical Qty, Delta, Delta%, Classification, Posting Status

**What the user sees:**
- Each tank row with its live IS-OIL data
- URGENT tanks highlighted in red
- Audit log tab showing M1 → M3 → M6 milestones

---

## Step 4 — Go to Approval Queue

**User Action:**
> Click **✅ Approval Queue** in the left sidebar

> ⚠️ *This page is visible only to users with the Supervisor or Admin role*

**What happens in the background:**
- CAP queries all `TankResults` where `classification = URGENT` and `postingStatus = PENDING`
- Only tanks waiting for human approval are shown

**What the user sees:**
- List of URGENT tanks with their delta values, run date, tank name
- **Approve** and **Reject** buttons for each

---

## Step 5 — Approve or Reject

**User Action (Approve):**
> Click **Approve** on a tank → optionally enter a comment → confirm

**What happens in the background:**
- CAP creates an `ApprovalRecord` with decision `APPROVED`, actor (user ID), timestamp, comment
- M4 audit entry written: *"M4.achieved: URGENT variance approved"*
- CAP attempts goods movement posting via `ZTANK_POST_SRV_SRV` in OGS (M5)
- If posting succeeds → `postingStatus = POSTED`, Material Document ID written back
- If posting fails → `postingStatus = FAILED`, error message recorded in audit trail

**User Action (Reject):**
> Click **Reject** → enter mandatory rejection reason → confirm

**What happens in the background:**
- `ApprovalRecord` created with decision `REJECTED`
- `postingStatus = REJECTED`, rejection reason stored
- M4 audit entry written: *"M4.achieved: URGENT variance rejected"*
- No goods movement is posted

---

## Step 6 — Check the Audit Trail

**User Action:**
> Click **📋 Audit Trail** in the left sidebar

**What the user sees:**
```
17/07/2026 13:42  M1  INGEST   –         ACHIEVED   M1.trigger: run initiated
17/07/2026 13:42  M3  VARIANCE Tank-001  ACHIEVED   M3.variance: delta=50 (0.45%) URGENT
17/07/2026 13:42  M3  VARIANCE Tank-002  ACHIEVED   M3.variance: delta=303178 (2753%) URGENT
17/07/2026 13:42  M6  REPORT   –         ACHIEVED   M6.complete: 2 tanks, alerts sent
17/07/2026 13:44  M4  APPROVAL Tank-001  ACHIEVED   M4.achieved: approved by supervisor
17/07/2026 13:44  M5  POSTING  Tank-001  FAILED     M5.failed: IS-OIL config required
```

**What happens in the background:**
- Every action, decision, and system event is permanently recorded
- Tamper-evident — entries cannot be modified
- Full traceability from raw dip reading to final posting decision

---

## Summary Flow Diagram

```
User triggers run
      ↓
[BTP CAP] creates PENDING run
      ↓
[OGS/650] reads OIB_TANKDIP via Cloud Connector
      ↓
[BTP CAP] computes delta, classifies tanks
      ↓
[Webhook] M6 alert sent 🔴🟡🟢
      ↓
Bell 🔔 shows notification count
      ↓
Supervisor opens Approval Queue
      ↓
Supervisor approves/rejects URGENT tanks
      ↓
[OGS/650] goods movement posting attempted
      ↓
Audit Trail shows complete M1→M6 history
```
