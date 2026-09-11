"""
Builds TSW_ETA_Agent_Architecture.pptx — focused purely on the TSW ETA Intelligence Agent.
Run: python build_ppt.py
"""
import sys, os
sys.path.insert(0, "/home/user/pptx_lib")

from pptx import Presentation
from pptx.util import Cm, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# ── helpers ───────────────────────────────────────────────────────────────────
def rgb(h):
    h = h.lstrip("#")
    return RGBColor(int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

def bg(slide, c):
    f = slide.background.fill; f.solid(); f.fore_color.rgb = rgb(c)

def box(slide, x, y, w, h, fill, border=None):
    from pptx.util import Cm
    shp = slide.shapes.add_shape(1, Cm(x), Cm(y), Cm(w), Cm(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = rgb(fill)
    if border:
        shp.line.color.rgb = rgb(border); shp.line.width = Pt(0.75)
    else:
        shp.line.fill.background()
    return shp

def rbox(slide, x, y, w, h, fill, border=None):
    shp = slide.shapes.add_shape(9, Cm(x), Cm(y), Cm(w), Cm(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = rgb(fill)
    if border:
        shp.line.color.rgb = rgb(border); shp.line.width = Pt(0.75)
    else:
        shp.line.fill.background()
    return shp

def txt(slide, x, y, w, h, text, size=12, bold=False,
        color="FFFFFF", align=PP_ALIGN.LEFT, italic=False):
    tb = slide.shapes.add_textbox(Cm(x), Cm(y), Cm(w), Cm(h))
    tf = tb.text_frame; tf.word_wrap = True
    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run(); r.text = line
        r.font.size = Pt(size); r.font.bold = bold
        r.font.italic = italic; r.font.color.rgb = rgb(color)

def card(slide, x, y, w, h, title, body,
         fill="1A3A55", border="00A3E0",
         tc="00A3E0", bc="B0D4EC", ts=13, bs=11):
    rbox(slide, x, y, w, h, fill, border)
    txt(slide, x+0.2, y+0.15, w-0.4, 0.65, title, ts, True, tc)
    box(slide, x+0.2, y+0.9,  w-0.4, 0.07, border)
    txt(slide, x+0.2, y+1.05, w-0.4, h-1.2, body, bs, False, bc)

# colours
NAVY   = "0D2137"; ACCENT = "00A3E0"; WHITE = "FFFFFF"
GOLD   = "F0A500"; GREEN  = "27AE60"; GREY  = "1A3A55"
DARK   = "0A1E30"; LIGHT  = "B0D4EC"; TEAL  = "0E3D5C"

# ── Presentation ──────────────────────────────────────────────────────────────
prs = Presentation()
prs.slide_width  = Cm(33.87)
prs.slide_height = Cm(19.05)
BL = prs.slide_layouts[6]   # blank

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — What is the TSW ETA Agent?
# ═══════════════════════════════════════════════════════════════════════════════
s1 = prs.slides.add_slide(BL)
bg(s1, NAVY)
box(s1, 0, 0, 0.5, 19.05, ACCENT)   # left stripe

txt(s1, 0.9, 0.55, 32.0, 1.4,
    "TSW ETA Intelligence Agent", 36, True, WHITE)
txt(s1, 0.9, 2.05, 32.0, 0.7,
    "What it does  ·  Why it exists  ·  How it works", 17, False, LIGHT)
box(s1, 0.9, 2.95, 32.0, 0.09, ACCENT)

# Problem statement box
rbox(s1, 0.9, 3.2, 32.0, 2.8, "0A1E30", ACCENT)
txt(s1, 1.1, 3.35, 31.6, 0.65,
    "THE PROBLEM", 12, True, ACCENT)
txt(s1, 1.1, 4.05, 31.6, 1.8,
    "Nomination planners estimate vessel ETAs manually — no live vessel tracking, no geopolitical awareness, "
    "no carrier performance history.  A wrong ETA causes missed loadings, demurrage charges and custody "
    "transfer disputes costing thousands of dollars per incident.",
    12, False, LIGHT)

# 4 capability cards — y=6.3
caps = [
    (ACCENT,  "Live AIS Tracking",
              "Queries MyShipTracking API\nby IMO / vessel name\nReturns live position + ETA UTC"),
    (TEAL,    "Geopolitical Risk",
              "GDELT global news scan\nDetects strikes, hurricanes,\nsanctions near the route"),
    (GREY,    "Carrier Performance",
              "Historical on-time % and\navg delay days per carrier\nfrom completed nominations"),
    (GREEN,   "Historical Patterns",
              "Avg lead-time by material\n× location × transport system\nfrom SAP TSW history"),
]
cw = 7.7; cg = 0.4; cy = 6.3; ch = 4.4
for i, (fill, title, body) in enumerate(caps):
    cx = 0.9 + i*(cw+cg)
    card(s1, cx, cy, cw, ch, title, body, fill=fill, ts=13, bs=11)

# Output box
rbox(s1, 0.9, 11.1, 32.0, 2.0, "0A2030", ACCENT)
txt(s1, 1.1, 11.25, 8.0, 0.7,  "OUTPUT", 12, True, ACCENT)
txt(s1, 1.1, 11.95, 31.6, 0.9,
    "Risk-adjusted ETA  ·  Confidence level (High / Medium / Low)  ·  "
    "Full adjustment table  ·  Supervisor approval prompt  ·  "
    "On approval: ETA + events written directly to SAP TSW",
    12, False, LIGHT)

txt(s1, 30.0, 18.4, 3.5, 0.5, "1 / 3", 10, False, GREY, PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — 9-Step Intelligence Flow
# ═══════════════════════════════════════════════════════════════════════════════
s2 = prs.slides.add_slide(BL)
bg(s2, NAVY)
box(s2, 0, 0, 0.5, 19.05, GOLD)

txt(s2, 0.9, 0.45, 32.0, 1.2,
    "TSW ETA Agent — 9-Step Intelligence Flow", 32, True, WHITE)
txt(s2, 0.9, 1.75, 32.0, 0.65,
    "Steps 1–6 run fully automatically without stopping  ·  "
    "Step 7 presents the report  ·  Supervisor approves or rejects",
    14, False, LIGHT)
box(s2, 0.9, 2.55, 32.0, 0.09, GOLD)

steps = [
    (ACCENT,  "STEP 1  ·  Fetch Nomination",
              "Tool: get_nomination\n"
              "Reads live data from SAP S/4 HANA TSW\n"
              "Extracts: Location, Material, Transport\n"
              "System, Scheduled Date, Carrier"),

    (GREY,    "STEP 2  ·  Live Vessel Tracking (AIS)",
              "Tools: get_port_vessel_etas\n"
              "         myshiptracking_lookup\n"
              "Queries MyShipTracking by vessel name / IMO\n"
              "Returns live vessel position + ETA UTC"),

    (GREY,    "STEP 3  ·  Historical Voyage Patterns",
              "Tool: get_nomination_history\n"
              "Analyses completed nominations in SAP TSW\n"
              "Computes avg lead-time days by\n"
              "material × location × transport system"),

    (GREY,    "STEP 4  ·  Carrier Performance",
              "Tool: analyze_carrier_performance\n"
              "Calculates per-carrier:\n"
              "· Average delay days\n"
              "· On-time delivery %"),

    (GREY,    "STEP 5  ·  Geopolitical Risk",
              "Tool: get_geopolitical_risk (GDELT)\n"
              "Scans global news near destination\n"
              "Detects: strikes, hurricanes, sanctions\n"
              "Returns risk level + delay buffer days"),

    (TEAL,    "STEP 6  ·  Calculate ETA",
              "Tool: calculate_eta_intelligence\n"
              "Base ETA (AIS or scheduled date)\n"
              "+ carrier adj + seasonal + geo buffer\n"
              "= Recommended ETA + Confidence"),

    (GREEN,   "STEP 7  ·  Present ETA Report",
              "Markdown ETA Intelligence Report:\n"
              "· Adjustment table (carrier/seasonal/geo)\n"
              "· Data sources used\n"
              "· Confidence level · Approval prompt"),

    (DARK,    "STEP 8  ·  Reject / Alternatives",
              "Tools: record_rejection_reason\n"
              "         get_nomination_history_deep\n"
              "Proposes 3 data-driven options:\n"
              "Conservative / Moderate / Optimistic"),

    (GOLD,    "STEP 9  ·  Approve & Write to SAP",
              "Tools: update_nomination_eta\n"
              "         update_nomination_events\n"
              "Writes to SAP TSW:\n"
              "Loading · Berthing · Discharge · Departure"),
]

bw, bh = 10.2, 5.1
gx, gy = 0.7,  0.35
sx, sy = 0.9,  2.8

for i, (fill, title, body) in enumerate(steps):
    col = i % 3; row = i // 3
    bx = sx + col*(bw+gx)
    by = sy + row*(bh+gy)
    card(s2, bx, by, bw, bh, title, body, fill=fill, ts=13, bs=11)

txt(s2, 30.0, 18.4, 3.5, 0.5, "2 / 3", 10, False, GREY, PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 3 — TSW ETA Agent Architecture
# ═══════════════════════════════════════════════════════════════════════════════
s3 = prs.slides.add_slide(BL)
bg(s3, NAVY)
box(s3, 0, 0, 0.5, 19.05, GREEN)

txt(s3, 0.9, 0.45, 32.0, 1.2,
    "TSW ETA Agent — System Architecture", 32, True, WHITE)
txt(s3, 0.9, 1.75, 32.0, 0.65,
    "All data fetched live  ·  No hardcoded values  ·  "
    "OData v2/v4  ·  REST/JSON  ·  SAP AI Core  ·  mTLS",
    14, False, LIGHT)
box(s3, 0.9, 2.55, 32.0, 0.09, GREEN)

# ── Central agent box  x=11  w=12  y=2.8  h=10.5
CX, CY, CW, CH = 11.0, 2.8, 12.0, 10.5
rbox(s3, CX, CY, CW, CH, DARK, ACCENT)
txt(s3, CX, CY+0.2, CW, 0.75,
    "TSW ETA Intelligence Agent", 16, True, ACCENT, PP_ALIGN.CENTER)
txt(s3, CX, CY+1.0, CW, 0.55,
    "Python  ·  LangGraph  ·  LangChain  ·  SAP BTP CF", 12, False, LIGHT, PP_ALIGN.CENTER)
box(s3, CX+0.3, CY+1.65, CW-0.6, 0.07, ACCENT)

agent_lines = [
    ("9-Step ETA Flow",                        WHITE,  12, True),
    ("",                                        WHITE,   4, False),
    ("· Fetch nomination from SAP TSW",         LIGHT,  11, False),
    ("· Query AIS vessel tracking",             LIGHT,  11, False),
    ("· Analyse historical voyage patterns",    LIGHT,  11, False),
    ("· Evaluate carrier performance",          LIGHT,  11, False),
    ("· Assess geopolitical risk (GDELT)",      LIGHT,  11, False),
    ("· Calculate risk-adjusted ETA",           LIGHT,  11, False),
    ("· Present report → supervisor approval",  LIGHT,  11, False),
    ("· Offer alternatives if rejected",        LIGHT,  11, False),
    ("· Write approved ETA & events to SAP",    LIGHT,  11, False),
    ("",                                        WHITE,   4, False),
    ("LLM: SAP AI Core  (GPT-4o)",              GOLD,   12, True),
]
ly = CY + 1.85
for line, col, size, bold in agent_lines:
    txt(s3, CX+0.4, ly, CW-0.8, 0.55,
        line, size, bold, col, PP_ALIGN.LEFT)
    ly += 0.55 if line else 0.2

# ── Left column: SAP systems  x=0.9  w=9.7
left = [
    ("0D4F6E", "SAP S/4 HANA — TSW Nominations",
              "OData: TSW_MYNOMINATIONS_SRV_01\n"
              "· get_nomination — fetch single nomination\n"
              "· list_nominations — browse open nominations\n"
              "· create_nomination — create new nomination\n"
              "· update_nomination_eta — write approved ETA\n"
              "· update_nomination_events — write events"),
    ("0D3060", "SAP S/4 HANA — History & Performance",
              "OData: TSW_MYNOMINATIONS_SRV_01\n"
              "· Completed nominations with completedAt\n"
              "· Carrier delay analysis per carrier code\n"
              "· Lead-time avg by material × location"),
]
lw = 9.7; lh = 4.9; lgy = 0.4
for i, (fill, title, body) in enumerate(left):
    by = 2.8 + i*(lh+lgy)
    card(s3, 0.9, by, lw, lh, title, body, fill=fill, ts=12, bs=10)

# ── Right column: External APIs  x=24.3  w=9.3
right = [
    ("2E0D4F", "AIS — MyShipTracking API",
              "REST/JSON · API Key auth\n"
              "· Vessel lookup by IMO / name\n"
              "· Live position (lat/lon)\n"
              "· Destination port ETA UTC\n"
              "· Speed, heading, vessel status"),
    ("4F1A0D", "GDELT — Geopolitical Risk API",
              "REST/JSON · Public API\n"
              "· News scan near destination port\n"
              "· Detects: strikes, hurricanes\n"
              "· Detects: sanctions, port closures\n"
              "· Returns risk level + delay buffer"),
]
rw = 9.3; rh = 4.9
for i, (fill, title, body) in enumerate(right):
    by = 2.8 + i*(rh+lgy)
    card(s3, 24.3, by, rw, rh, title, body, fill=fill, ts=12, bs=10)

# ── Bottom row: Nomination MCP Server + Output
box(s3, 0.9,  13.55, 14.5, 2.5, "0A2030", ACCENT)
txt(s3, 1.1,  13.7,  4.0,  0.65, "MCP SERVER", 12, True, ACCENT)
txt(s3, 1.1,  14.35, 14.1, 1.5,
    "nomination-mcp-server  (Python · FastAPI)\n"
    "Exposes SAP TSW nomination tools to the agent via MCP protocol\n"
    "Tools: get_nomination · list_nominations · create_nomination · update_nomination_eta · update_nomination_events",
    10, False, LIGHT)

box(s3, 15.8, 13.55, 18.1, 2.5, "0A2030", GREEN)
txt(s3, 16.0, 13.7,  4.0,  0.65, "OUTPUT TO SAP TSW", 12, True, GREEN)
txt(s3, 16.0, 14.35, 17.7, 1.5,
    "Approved ETA written to nomination record  ·  "
    "Events recorded: Loading · Berthing · Discharge · Departure  ·  "
    "All supervisor decisions stored in CAP audit log",
    10, False, LIGHT)

txt(s3, 30.0, 18.4, 3.5, 0.5, "3 / 3", 10, False, GREY, PP_ALIGN.RIGHT)

# ── Save ──────────────────────────────────────────────────────────────────────
path = "TSW_ETA_Agent_Architecture.pptx"
prs.save(path)
print(f"Saved {path}  ({os.path.getsize(path):,} bytes)")
