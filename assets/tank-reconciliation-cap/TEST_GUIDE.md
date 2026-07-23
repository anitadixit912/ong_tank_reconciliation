# Tank Stock Reconciliation — Tester Guide

## Test Environment

**App URL:** `https://tank-reconciliation-approuter-proud-jackal-qo.cfapps.us10.hana.ondemand.com`

**Login:** Use your SAP BTP credentials (same as BTP Cockpit)

**Role required:** `TankRecon_Admin` role collection must be assigned to your user

---

## Test Scenario 1 — Trigger a Reconciliation Run

**Steps:**
1. Open the Dashboard
2. Select today's date in the **Run Date** field
3. Click **⚡ Trigger Run**
4. Wait 5-10 seconds for the run to complete

**What to check:**
- ✅ Run appears in the **Recent Reconciliation Runs** table
- ✅ Status shows **COMPLETED**
- ✅ Tank Count shows **2**
- ✅ 🔔 Bell icon shows a badge with unread count
- ✅ Webhook notification received (check webhook.site)

**Expected Classifications:**
| Tank | Expected | Why |
|------|----------|-----|
| C3 Propane USMOB-17T2 | 🟢 GREEN or 🔴 RED | Depends on latest dip data |
| Diesel USMOB-17T1 | 🔴 RED | Large variance from stale dip |

---

## Test Scenario 2 — Multiple Runs Same Day

**Steps:**
1. Trigger a run for today
2. Trigger **another** run for today again

**What to check:**
- ✅ Second run is allowed (no "run already exists" error)
- ✅ Both runs appear in the table with different timestamps
- ✅ Run time shown in Audit Log: `"M1.trigger: run initiated for 2026-07-22 at 10:30:45"`

---

## Test Scenario 3 — View Run Details

**Steps:**
1. Click **View** on any completed run

**What to check:**
- ✅ **Tank Results** tab shows both tanks
- ✅ Columns: Tank ID, Name, Plant, SLOC, Book Stock, Physical, Delta, UoM, Delta%, Classification, Posting Status
- ✅ **UoM column** shows `TO` (not `L`)
- ✅ **SLOC** shows `17T1`
- ✅ Classification shows 🟢 Green / 🟡 Amber / 🔴 Red

**Audit Log tab — check for:**
- ✅ `M1 INGEST ACHIEVED` — run initiated with time
- ✅ `M1 INGEST ACHIEVED` — input_check entry (for suspicious data)
- ✅ `M2 VCF ACHIEVED` — VCF factor applied per tank
- ✅ `M3 VARIANCE ACHIEVED` — delta calculated per tank
- ✅ `M6 REPORT ACHIEVED` — alerts sent

---

## Test Scenario 4 — Notification Bell

**Steps:**
1. After triggering a run, click the 🔔 bell icon in the top bar

**What to check:**
- ✅ Panel opens showing run summary
- ✅ 🔴 RED / 🟡 Amber / 🟢 Green color coding
- ✅ Shows tank counts and pending approval count
- ✅ **Click a RED notification** → navigates to Approval Queue
- ✅ **Click a GREEN/completed notification** → navigates to run detail
- ✅ Badge count decreases after clicking (marks as read)
- ✅ Badge updates after approving a tank

---

## Test Scenario 5 — Approval Queue

**Steps:**
1. Click **✅ Approval Queue** in the left sidebar
2. You should see RED-classified tanks

**What to check:**
- ✅ Only RED tanks with PENDING status appear
- ✅ Table shows: Run Date, Tank ID, Tank Name, Delta, Delta%, Book Stock, Physical, UoM
- ✅ UoM shows `TO` not `L`
- ✅ Click **Review** on a tank

**Review Panel — check:**
- ✅ **Reason Code dropdown** appears with 6 options:
  - 01 — Measurement
  - 02 — Transport Gain
  - 03 — Transport Losses
  - 04 — Customer not available
  - 05 — Insufficient quantity delivered
  - 06 — Lost quantity
- ✅ **Comment field** is present
- ✅ **Approve** and **Reject** buttons present

---

## Test Scenario 6 — Approve a Tank

**Steps:**
1. In Approval Queue, click **Review**
2. Select reason code **01 — Measurement**
3. Enter comment: `Test approval`
4. Click **✓ Approve**

**What to check:**
- ✅ Success message appears
- ✅ Tank disappears from Approval Queue
- ✅ Go to Run Detail → tank shows `✅ Posted` or `⚠️ Post Failed` (IS-OIL config pending)
- ✅ Audit Log shows `M4 APPROVAL ACHIEVED` with approver name and reason code `[01]`
- ✅ If variance >1000% → audit shows `HIGH VARIANCE WARNING` message
- ✅ Audit Log shows `M5 POSTING` entry (ACHIEVED or FAILED)

---

## Test Scenario 7 — Reject a Tank

**Steps:**
1. In Approval Queue, click **Review**
2. Select reason code **06 — Lost quantity**
3. Enter comment: `Stale dip data — re-measurement needed`
4. Click **✗ Reject**

**What to check:**
- ✅ Rejection requires a comment (cannot reject without comment)
- ✅ Tank disappears from Approval Queue
- ✅ Posting Status shows `✗ Rejected`
- ✅ Audit shows `M4 APPROVAL ACHIEVED` with rejection reason and reason code `[06]`

---

## Test Scenario 8 — AI Assistant

**Steps:**
1. Click **💬 AI Assistant** in the left sidebar
2. Ask these questions one by one:

| Question | Expected Response |
|----------|------------------|
| "What is the status of the latest run?" | Run date, tank counts, GREEN/AMBER/RED breakdown, pending/rejected counts |
| "Which tanks are flagged today?" | List of AMBER tanks or "No FLAG variances" |
| "Give me a summary of today's results" | Bullet-point summary with counts and timestamps |
| "Recommendation for 00000000000000000023" | Specific recommendation based on variance % and posting status |
| "Which tanks need approval?" | List of pending RED tanks or "No tanks require approval" |

**What to check:**
- ✅ Chat history persists when navigating away and returning
- ✅ User messages shown in **blue** (right side)
- ✅ AI responses shown in **grey** (left side)
- ✅ Chat is **scrollable** up to see earlier messages
- ✅ **🗑 Clear Chat** button resets history
- ✅ Already-rejected tanks show `"This posting has already been REJECTED"`

---

## Test Scenario 9 — Audit Trail

**Steps:**
1. Click **📋 Audit Trail** in the left sidebar

**What to check:**
- ✅ All milestones M1 → M6 visible in chronological order
- ✅ Each entry shows: Timestamp, Milestone, Step, Tank, Outcome, Actor, Message
- ✅ M1 shows input_check warnings for suspicious data
- ✅ M4 shows approval/rejection decisions with reason codes
- ✅ M5 shows posting attempt result
- ✅ M6 shows alerts sent confirmation

---

## Test Scenario 10 — Configuration (Admin only)

**Steps:**
1. Click **⚙️ Configuration** in the left sidebar

**What to check:**
- ✅ Shows both tanks with their thresholds
- ✅ `toleranceOkPct = 0.50` (GREEN threshold ≤0.5%)
- ✅ `toleranceFlagPct = 2.00` (AMBER 0.5-2%, RED >2%)
- ✅ SLOC shows `17T1`
- ✅ Can edit tank thresholds

---

## Intelligence Features — Verification

### Threshold Violations
- 🟢 GREEN (≤0.5%) → auto-post attempted
- 🟡 AMBER (0.5–2%) → auto-post attempted
- 🔴 RED (>2%) → held for supervisor approval

### License Constraints
- Inactive tanks → blocked from posting (403 error)
- Variance >1000% → `HIGH VARIANCE WARNING` in M4 audit entry

### Non-Standard Input Detection (M1 Audit)
| Condition | Audit Message |
|-----------|--------------|
| Physical qty ≤ 0 | `INVALID: Physical quantity is zero or negative` |
| Physical qty > 500,000 TO | `SUSPICIOUS: Physical quantity exceeds 500,000 TO` |
| Book stock ≤ 0 | `WARNING: Book stock is zero or negative` |
| Variance > 1000% | `DATA_QUALITY: Variance X% exceeds 1000%` |

---

## Known Limitations

| Item | Status | Notes |
|------|--------|-------|
| M5 Goods Movement Posting | ✅ Complete | PI BAPIs implemented — BAPI_MATPHYSINV_CREATE → COUNT → POSTDIFF. Dip timestamp used as count date. Material doc returned and stored. |
| VCF Calculation | ✅ Complete | QUAN_SKU in OIB_TANKDIP is already VCF-corrected by IS-OIL — factor 1.0 is correct, no external API needed |
| Authentication | ✅ Working | XSUAA via AppRouter |
| Role-based access | ✅ Working | Approvals: Supervisor only, Config: Admin only |
