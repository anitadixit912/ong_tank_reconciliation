"""
Builds TSW_ETA_Agent_Architecture.pptx using python-pptx.
Run: python build_ppt.py
"""
import sys
sys.path.insert(0, "/home/user/pptx_lib")

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Cm

# ── helpers ───────────────────────────────────────────────────────────────────
def rgb(hex_str):
    h = hex_str.lstrip("#")
    return RGBColor(int(h[0:2],16), int(h[2:4],16), int(h[4:6],16))

def bg(slide, color_hex):
    """Fill slide background."""
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = rgb(color_hex)

def box(slide, x, y, w, h, fill_hex, border_hex=None, radius=False):
    """Add a filled rectangle (no text)."""
    from pptx.util import Emu
    shape = slide.shapes.add_shape(
        1 if not radius else 5,   # MSO_SHAPE_TYPE: rectangle=1, rounded=5
        Cm(x), Cm(y), Cm(w), Cm(h)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb(fill_hex)
    if border_hex:
        shape.line.color.rgb = rgb(border_hex)
        shape.line.width = Pt(0.75)
    else:
        shape.line.fill.background()
    return shape

def label(slide, x, y, w, h, text, size=12, bold=False, color="FFFFFF",
          align=PP_ALIGN.LEFT, italic=False, wrap=True):
    """Add a text box."""
    txBox = slide.shapes.add_textbox(Cm(x), Cm(y), Cm(w), Cm(h))
    tf = txBox.text_frame
    tf.word_wrap = wrap
    tf.auto_size = None
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = rgb(color)
    return txBox

def card(slide, x, y, w, h, title, body,
         fill="1A3A55", border="00A3E0",
         title_color="00A3E0", body_color="B0D4EC",
         title_size=12, body_size=10):
    """Rounded card with title + body text."""
    from pptx.oxml.ns import qn
    from lxml import etree
    shp = slide.shapes.add_shape(9, Cm(x), Cm(y), Cm(w), Cm(h))  # 9 = roundRect
    shp.fill.solid()
    shp.fill.fore_color.rgb = rgb(fill)
    shp.line.color.rgb = rgb(border)
    shp.line.width = Pt(0.75)
    # title
    label(slide, x+0.15, y+0.12, w-0.3, 0.55,
          title, size=title_size, bold=True, color=title_color)
    # body
    label(slide, x+0.15, y+0.72, w-0.3, h-0.85,
          body, size=body_size, color=body_color)

# ── Colours ───────────────────────────────────────────────────────────────────
NAVY   = "0D2137"
ACCENT = "00A3E0"
WHITE  = "FFFFFF"
GOLD   = "F0A500"
GREEN  = "27AE60"
GREY   = "1A3A55"
DARK   = "0A1E30"
LIGHT  = "B0D4EC"

# ═══════════════════════════════════════════════════════════════════════════════
prs = Presentation()
prs.slide_width  = Cm(33.87)   # 16:9 widescreen
prs.slide_height = Cm(19.05)
blank_layout = prs.slide_layouts[6]  # blank

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — Title & Overview
# ═══════════════════════════════════════════════════════════════════════════════
s1 = prs.slides.add_slide(blank_layout)
bg(s1, NAVY)

# Left accent stripe
box(s1, 0, 0, 0.4, 19.05, ACCENT)

# Title
label(s1, 0.8, 0.6, 32.0, 1.4,
      "TSW ETA Intelligence Agent",
      size=36, bold=True, color=WHITE)

# Subtitle
label(s1, 0.8, 2.1, 32.0, 0.8,
      "Architecture  ·  Data Flow  ·  System Integration Overview",
      size=18, color=LIGHT)

# Accent divider
box(s1, 0.8, 3.1, 32.0, 0.1, ACCENT)

# 3 KPI cards  — y=3.4, each w=10.2, gap=0.7
kpis = [
    ("2 AI Agents",    "Nomination ETA Agent\nTank Reconciliation Agent"),
    ("5 Live Systems", "S/4 HANA · AIS Tracking · GDELT\nBTP Services · TSW OData"),
    ("End-to-End",     "Open nomination →\nApproved ETA in SAP TSW"),
]
kw, kg = 10.2, 0.7
for i, (t, b) in enumerate(kpis):
    kx = 0.8 + i*(kw + kg)
    card(s1, kx, 3.4, kw, 3.5, t, b,
         title_size=15, body_size=12)

# Summary
label(s1, 0.8, 7.3, 32.0, 2.2,
      "The TSW ETA Agent combines live AIS vessel tracking, GDELT geopolitical risk intelligence, "
      "carrier performance analysis and historical voyage patterns to propose risk-adjusted ETAs for "
      "SAP TSW nominations.  The Tank Reconciliation Agent automates ATG gauge ingestion, VCF "
      "temperature correction, variance classification and SAP S/4 HANA HPM goods movement posting.",
      size=12, color=LIGHT)

# Technology tags — 2 rows × 3
tags = [
    "Python  ·  LangGraph  ·  LangChain",
    "SAP BTP  Cloud Foundry",
    "SAP AI Core  (GPT-4o)",
    "OData v2/v4  ·  REST APIs",
    "React  +  SAP UI5 Web Components",
    "n8n  Workflow Automation",
]
tw, tg, th = 10.2, 0.7, 0.9
for i, tag in enumerate(tags):
    col = i % 3
    row = i // 3
    tx = 0.8 + col*(tw + tg)
    ty = 9.8 + row*(th + 0.2)
    box(s1, tx, ty, tw, th, DARK, ACCENT)
    label(s1, tx+0.2, ty+0.1, tw-0.4, th-0.15,
          tag, size=11, color=WHITE, align=PP_ALIGN.CENTER)

# Slide number
label(s1, 30.5, 18.4, 3.0, 0.5, "1 / 3", size=10, color=GREY, align=PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — 9-Step Intelligence Flow
# ═══════════════════════════════════════════════════════════════════════════════
s2 = prs.slides.add_slide(blank_layout)
bg(s2, NAVY)
box(s2, 0, 0, 0.4, 19.05, GOLD)

label(s2, 0.8, 0.5, 32.0, 1.3,
      "TSW ETA Agent — 9-Step Intelligence Flow",
      size=32, bold=True, color=WHITE)
label(s2, 0.8, 1.9, 32.0, 0.7,
      "All 6 data-gathering steps run automatically without stopping  ·  Supervisor approves every final ETA",
      size=14, color=LIGHT)
box(s2, 0.8, 2.75, 32.0, 0.1, GOLD)

steps = [
    (ACCENT,   "STEP 1  ·  Fetch Nomination",
               "get_nomination\nExtracts: Location, Material, Transport\nSystem, Scheduled Date, Carrier"),
    (GREY,     "STEP 2  ·  Live Vessel (AIS)",
               "get_port_vessel_etas\nmyshiptracking_lookup\nLive ETA UTC from AIS transponder"),
    (GREY,     "STEP 3  ·  Historical Patterns",
               "get_nomination_history\nAvg lead-time days by\nmaterial × location × transport"),
    (GREY,     "STEP 4  ·  Carrier Performance",
               "analyze_carrier_performance\nAvg delay days  ·  on-time %\nfor this carrier code"),
    (GREY,     "STEP 5  ·  Geopolitical Risk",
               "get_geopolitical_risk  (GDELT)\nRisk level + buffer days\nfor route & scheduled date"),
    ("0E3D5C", "STEP 6  ·  Calculate ETA",
               "calculate_eta_intelligence\nBase ETA + carrier + seasonal\n+ geo buffer = Recommended ETA"),
    (GREEN,    "STEP 7  ·  Present Report",
               "Markdown ETA Intelligence Report\nAdjustment table  ·  Data Sources\nConfidence level  ·  Approval prompt"),
    (DARK,     "STEP 8  ·  Reject / Alternatives",
               "record_rejection_reason\nget_nomination_history_deep\n3 data-driven option table"),
    (GOLD,     "STEP 9  ·  Approve & Record",
               "update_nomination_eta\nupdate_nomination_events\nLoading / Berthing / Discharge / Departure → SAP"),
]

bw, bh = 10.2, 5.0
gx, gy = 0.7,  0.4
sx, sy = 0.8,  3.0

for i, (fill, title, body) in enumerate(steps):
    col = i % 3
    row = i // 3
    bx = sx + col*(bw + gx)
    by = sy + row*(bh + gy)
    card(s2, bx, by, bw, bh, title, body,
         fill=fill, title_size=13, body_size=11)

label(s2, 30.5, 18.4, 3.0, 0.5, "2 / 3", size=10, color=GREY, align=PP_ALIGN.RIGHT)

# ═══════════════════════════════════════════════════════════════════════════════
# SLIDE 3 — System Integration Architecture
# ═══════════════════════════════════════════════════════════════════════════════
s3 = prs.slides.add_slide(blank_layout)
bg(s3, NAVY)
box(s3, 0, 0, 0.4, 19.05, GREEN)

label(s3, 0.8, 0.5, 32.0, 1.3,
      "System Integration Architecture",
      size=32, bold=True, color=WHITE)
label(s3, 0.8, 1.9, 32.0, 0.7,
      "All connections live  ·  OData v2/v4  ·  REST/JSON  ·  SAP Cloud Connector  ·  mTLS",
      size=14, color=LIGHT)
box(s3, 0.8, 2.75, 32.0, 0.1, GREEN)

# ── Central BTP box  x=10.5  w=13.0  y=3.0  h=12.0
CX, CY, CW, CH = 10.5, 3.0, 13.0, 12.0
box(s3, CX, CY, CW, CH, DARK, ACCENT)
label(s3, CX+0.2, CY+0.2, CW-0.4, 0.8,
      "SAP BTP — Cloud Foundry",
      size=15, bold=True, color=ACCENT, align=PP_ALIGN.CENTER)
box(s3, CX+0.3, CY+1.1, CW-0.6, 0.08, ACCENT)

btp = [
    ("NominationETA Agent  (Python · LangGraph)",          WHITE,  13, True),
    ("  9-step ETA flow · AIS · GDELT · Carrier · History", LIGHT,  11, False),
    ("",                                                    WHITE,   6, False),
    ("TankReconciliation Agent  (Python · LangGraph)",      WHITE,  13, True),
    ("  ATG ingest · VCF calc · Variance · Approval",       LIGHT,  11, False),
    ("",                                                    WHITE,   6, False),
    ("CAP Node.js Backend  +  React UI5 Dashboard",         WHITE,  13, True),
    ("",                                                    WHITE,   6, False),
    ("n8n Reconciliation Workflow Engine",                   WHITE,  13, True),
    ("",                                                    WHITE,   6, False),
    ("SAP AI Core  ·  GPT-4o",                              GOLD,   13, True),
]
ly = CY + 1.3
for text, col, size, bold in btp:
    label(s3, CX+0.3, ly, CW-0.6, 0.6,
          text, size=size, bold=bold, color=col, align=PP_ALIGN.CENTER)
    ly += 0.6 if text else 0.25

# ── Left column  x=0.8  w=9.3  (3 boxes stacked)
left = [
    ("0D4F6E", "SAP S/4 HANA IS-OIL / TSW",
     "TSW_MYNOMINATIONS_SRV_01\nAPI_MATERIAL_STOCK_SRV\nAPI_MATERIAL_DOCUMENT_SRV\nMEASUREMENTDOCUMENT_0001"),
    ("0D3A2A", "ATG System",
     "Automatic Tank Gauging\nReal-time level readings\nElectronic gauge protocol"),
    ("3A2A0D", "Fiori Mobile Capture",
     "API_PHYSICAL_INVENTORY_DOC_SRV\nManual dip entries from field operators"),
]
lbh = 3.6
for i, (fill, title, body) in enumerate(left):
    by = 3.0 + i*(lbh + 0.4)
    card(s3, 0.8, by, 9.3, lbh, title, body,
         fill=fill, title_size=12, body_size=10)

# ── Right column  x=24.0  w=9.7
right = [
    ("2E0D4F", "AIS Vessel Tracking",
     "MyShipTracking API\nLive vessel position & ETA\nIMO / MMSI lookup"),
    ("4F1A0D", "GDELT Geopolitical",
     "Global news event scan\nStrike · Hurricane · Sanction\nRoute risk + delay buffer"),
    ("0D4040", "SAP BTP Services",
     "Alert Notification Service\nMS Teams Webhook\nEmail / SMTP Distribution"),
]
for i, (fill, title, body) in enumerate(right):
    by = 3.0 + i*(lbh + 0.4)
    card(s3, 24.0, by, 9.7, lbh, title, body,
         fill=fill, title_size=12, body_size=10)

# Connection layer bar at bottom
box(s3, 0.8, 15.2, 32.0, 0.9, "0A2030", ACCENT)
label(s3, 0.8, 15.3, 32.0, 0.75,
      "Connection Layer:  OData v2/v4  ·  REST/JSON  ·  SAP Cloud Connector  ·  Destination Service  ·  mTLS",
      size=12, color=ACCENT, align=PP_ALIGN.CENTER)

label(s3, 30.5, 18.4, 3.0, 0.5, "3 / 3", size=10, color=GREY, align=PP_ALIGN.RIGHT)

# ── Save ──────────────────────────────────────────────────────────────────────
path = "TSW_ETA_Agent_Architecture.pptx"
prs.save(path)
import os
print(f"Saved {path}  ({os.path.getsize(path):,} bytes)")
