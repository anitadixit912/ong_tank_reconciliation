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
- ✅ Run appears in the **Recent Reconciliation Runs** table (sorted by trigger time, latest first)
- ✅ Status shows **COMPLETED**
- ✅ Tank Count shows **2**
- ✅ 🔔 Bell icon shows a badge with unread count
- ✅ Webhook notification received (check webhook.site)

**Expected Classifications:**
| Tank | Expected | Why |
|------|----------|-----|
| C3 Propane USMOB-17T2 | 🟢 GREEN or 🔴 RED | Depends on latest dip data |
| Diesel USMOB-17T1 | 🔴 RED | Large variance |

---

## Test Scenario 2 — Multiple Runs Same Day

**Steps:**
1. Trigger a run for today
2. Trigger **another** run for today again

**What to check:**
- ✅ Second run is allowed (no "run already exists" error)
- ✅ Both runs appear in the table sorted by triggered time (latest first)
- ✅ Run time shown in Audit Log: `"M1.trigger: run initiated for 2026-07-29 at 10:30:45"`

---

## Test Scenario 3 — View Run Details

**Steps:**
1. Click **View** on any completed run
2. Use the **← Dashboard** back button to return

**What to check:**
- ✅ **Tank Results** tab shows both tanks
- ✅ Columns: Tank ID, Name, Plant, SLOC, **Dip Date/Time**, Book Stock, Physical, Delta, UoM, Delta%, Classification, Posting Status, Material Doc
- ✅ **Dip Date/Time** shows the timestamp when ATG measurement was taken
- ✅ **UoM column** shows `TO`
- ✅ **SLOC** shows `17T1`
- ✅ Classification shows 🟢 Green / 🟡 Amber / 🔴 Red
- ✅ Posted tanks show **📄 material document link** — click it to open MIGO in OGS/650 Fiori

**Audit Log tab — check for:**
- ✅ `M1 INGEST ACHIEVED` — run initiated with time
- ✅ `M1 INGEST ACHIEVED` — input_check entry (for suspicious data)
- ✅ `M2 VCF ACHIEVED` — physical quantity shown with IS-OIL correction note
- ✅ `M3 VARIANCE ACHIEVED` — delta calculated per tank with **AI Recommendation in bold**
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
3. Use **← Dashboard** to go back

**What to check:**
- ✅ Only RED tanks with PENDING status appear
- ✅ Table shows: Run Date, Tank ID, Tank Name, Delta, Delta%, Book Stock, Physical, UoM
- ✅ UoM shows `TO`
- ✅ Click **Review** on a tank

**Review Panel — check:**
- ✅ **Reason Code dropdown** loads dynamically from T157D (IS-OIL table) — codes may vary
- ✅ Reason code is **mandatory** for RED approval (cannot approve without selecting one)
- ✅ **Comment field** is present (mandatory for rejection)
- ✅ **Approve** and **Reject** buttons present
- ✅ **📋 Open TSW Nominations** section shows live nominations from OGS/650
- ✅ **View All** button opens full nominations modal with all details

---

## Test Scenario 6 — Approve a Tank

**Steps:**
1. In Approval Queue, click **Review**
2. Select a reason code from the dropdown (mandatory)
3. Enter comment: `Test approval`
4. Click **✓ Approve**

**What to check:**
- ✅ Error shown if no reason code selected: "A reason code is mandatory for RED variance approval"
- ✅ Success message appears after selection + approval
- ✅ Tank disappears from Approval Queue
- ✅ Go to Run Detail → tank shows `✅ Posted` or `⚠️ Post Failed`
- ✅ Audit Log shows `M4 APPROVAL ACHIEVED` with reason code and **AI Info in bold**
- ✅ If variance >1000% → audit shows `HIGH VARIANCE WARNING` message
- ✅ Audit Log shows `M5 POSTING` entry (ACHIEVED or FAILED) with Physical/BookStock/Delta values
- ✅ If M5 FAILED → **AI Recommendation in bold** explains what to do

---

## Test Scenario 7 — Reject a Tank

**Steps:**
1. In Approval Queue, click **Review**
2. Select a reason code from the dropdown
3. Enter comment: `Re-measurement needed`
4. Click **✗ Reject**

**What to check:**
- ✅ Rejection requires a comment (cannot reject without comment)
- ✅ Tank disappears from Approval Queue
- ✅ Posting Status shows `✗ Rejected`
- ✅ Audit shows `M4 APPROVAL ACHIEVED` with reason code, comment and **AI Info in bold**

---

## Test Scenario 8 — AI Assistant

**Steps:**
1. Click **💬 AI Assistant** in the left sidebar
2. Use **← Dashboard** to go back
3. Ask these questions one by one:

| Question | Expected Response |
|----------|------------------|
| "What is the status of the latest run?" | Run date, tank counts, GREEN/AMBER/RED breakdown, pending/rejected counts |
| "Which tanks are flagged today?" | List of AMBER tanks or "No AMBER variances" |
| "Give me a summary of today's results" | Bullet-point summary with counts and timestamps |
| "Recommendation for 00000000000000000023" | Specific recommendation based on variance % and posting status |
| "Which tanks need approval?" | List of pending RED tanks or "No tanks require approval" |
| "What is the reason code in approving the tank Diesel Tank USMOB-17T1?" | Shows decision, reason code, comment and posting status |
| "Why was the posting failed in tank Diesel Tank USMOB-17T1?" | Shows failure reason and action to take |

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
2. Use **← Dashboard** to go back
3. Test the **Date From/To filters**

**What to check:**
- ✅ All milestones M1 → M6 visible in chronological order
- ✅ Each entry shows: Timestamp, Milestone, Step, Tank, Outcome, Actor, Message
- ✅ **Date From/To filter** narrows results correctly
- ✅ M1 shows input_check warnings for suspicious data
- ✅ M2 shows VCF message in plain English
- ✅ M3 shows **AI Recommendation in bold** on new line
- ✅ M4 shows approval/rejection decisions with reason codes and **AI Info in bold**
- ✅ M5 shows posting result with Physical/BookStock/Delta values and **AI Recommendation in bold** on failure
- ✅ M6 shows alerts sent confirmation

---

## Test Scenario 10 — Configuration (Admin only)

**Steps:**
1. Click **⚙️ Configuration** in the left sidebar
2. Use **← Dashboard** to go back

**What to check:**
- ✅ Shows both tanks with their thresholds
- ✅ `toleranceOkPct = 0.50` (GREEN threshold ≤0.5%)
- ✅ `toleranceFlagPct = 2.00` (AMBER 0.5-2%, RED >2%)
- ✅ SLOC shows `17T1`
- ✅ Can edit tank thresholds

---

## Test Scenario 11 — Dip Timestamp in Run Detail

**Steps:**
1. Trigger a run and click View
2. Check the Tank Results table

**What to check:**
- ✅ **Dip Date/Time** column shows the exact timestamp when the ATG measurement was taken (e.g. `2026-07-27 11:41:00`)
- ✅ Different tanks may show different dip timestamps

---

## Test Scenario 12 — Material Document Link

**Steps:**
1. Approve a RED tank successfully
2. Go to Run Detail → Tank Results tab

**What to check:**
- ✅ Material Doc column shows **📄 4900000XXX** as a clickable link
- ✅ Clicking the link opens MIGO transaction in OGS/650 Fiori Launchpad
- ✅ Material document details are displayed

---

## Test Scenario 13 — Open TSW Nominations

**Steps:**
1. Go to Approval Queue → click Review on a RED tank

**What to check:**
- ✅ **📋 Open TSW Nominations** section appears at the bottom of the review panel
- ✅ Shows top 3 nominations inline with Nomination #, Material, Qty, Date, Status
- ✅ **View All** button opens full modal with complete list
- ✅ Modal shows: Nomination #, Item, Material, Qty, UoM, Scheduled Date, Type (Origin/Destination), Item Status, Header Status

---

## Test Scenario 14 — Back to Dashboard Navigation

**Steps:**
1. Navigate to each page: Approval Queue, Audit Trail, Configuration, Trend Chart, AI Chat

**What to check:**
- ✅ Each page shows **← Dashboard** link at the top
- ✅ Clicking it returns to the Dashboard

---

## Test Scenario 15 — Fiori Launchpad Tile

**Steps:**
1. Open OGS/650 Fiori Launchpad: `https://10.236.250.15:44301/sap/bc/ui2/flp?sap-client=650&sap-language=EN#Shell-home`

**What to check:**
- ✅ **Tank Reconciliation** tile is visible on the home page
- ✅ Clicking the tile opens the CAP app Approval Queue

---

## Intelligence Features — Verification

### Threshold Violations
- 🟢 GREEN (≤0.5%) → auto-post attempted
- 🟡 AMBER (0.5–2%) → auto-post attempted; if not actioned within 8 hours, auto-posts on next run trigger
- 🔴 RED (>2%) → held for supervisor approval; reason code mandatory

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
| Open TSW Nominations | ✅ Complete | NominationSet OData in ZTANK_DIP_SRV_SRV — shows in Approval Queue review panel with View All modal |
| Authentication | ✅ Working | XSUAA via AppRouter |
| Role-based access | ✅ Working | Approvals: Supervisor only, Config: Admin only |
| OIH01 entry for HT 99 | ⚠️ Pending | Expert to add 1710/1743/A2/99 entry in OIH01 to enable untaxed postings for plant 1743 |
