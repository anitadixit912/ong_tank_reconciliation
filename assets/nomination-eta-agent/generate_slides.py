"""Generate TSW ETA Agent slides.
  Slide 1: Vertical single-column workflow (Steps 1-9)
  Slide 2: 3-column architecture (unchanged from V5)
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from lxml import etree

# ── Palette ───────────────────────────────────────────────────────────────────
DARK_BG      = RGBColor(0x0D, 0x11, 0x17)
PANEL_BG     = RGBColor(0x16, 0x1B, 0x22)
BORDER_BLUE  = RGBColor(0x1F, 0x6F, 0xEB)
TEXT_WHITE   = RGBColor(0xE6, 0xED, 0xF3)
TEXT_GRAY    = RGBColor(0x8B, 0x94, 0x9E)
TEXT_DIM     = RGBColor(0x6E, 0x76, 0x81)
BLUE_LIGHT   = RGBColor(0x58, 0xA6, 0xFF)
GREEN        = RGBColor(0x3F, 0xB9, 0x50)
YELLOW       = RGBColor(0xE3, 0xB3, 0x41)
RED          = RGBColor(0xF8, 0x51, 0x49)
PURPLE       = RGBColor(0xD2, 0xA8, 0xFF)
PILL_BG      = RGBColor(0x21, 0x26, 0x2D)
S4_BLUE      = RGBColor(0x38, 0x8B, 0xFD)
AIS_GREEN    = RGBColor(0x23, 0x86, 0x36)
GDELT_YELLOW = RGBColor(0xD2, 0x99, 0x22)
LIGHT_PINK   = RGBColor(0xFF, 0xB3, 0xC6)

SLIDE_W = Inches(13.33)
SLIDE_H = Inches(7.5)

# ── Base helpers ──────────────────────────────────────────────────────────────

def new_prs():
    prs = Presentation()
    prs.slide_width  = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs

def blank_slide(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])

def fill_bg(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color

def rect(slide, l, t, w, h, fill=None, line=None, lw=Pt(1)):
    s = slide.shapes.add_shape(1, l, t, w, h)
    s.line.width = lw
    if fill: s.fill.solid(); s.fill.fore_color.rgb = fill
    else:    s.fill.background()
    if line: s.line.color.rgb = line
    else:    s.line.fill.background()
    return s

def txt(slide, l, t, w, h, text, size=Pt(10), bold=False,
        color=TEXT_WHITE, align=PP_ALIGN.LEFT, wrap=True, font="Calibri"):
    tb = slide.shapes.add_textbox(l, t, w, h)
    tf = tb.text_frame; tf.word_wrap = wrap
    p  = tf.paragraphs[0]; p.alignment = align
    r  = p.add_run(); r.text = text
    r.font.size = size; r.font.bold = bold
    r.font.color.rgb = color; r.font.name = font
    return tb

def dot(slide, l, t, color, size=Inches(0.11)):
    s = slide.shapes.add_shape(1, l, t, size, size)
    s.fill.solid(); s.fill.fore_color.rgb = color
    s.line.fill.background()

def _rgb_hex(c): return f"{c[0]:02X}{c[1]:02X}{c[2]:02X}"

def line_arrow(slide, x1, y1, x2, y2, color=BLUE_LIGHT, w=1.5):
    """Raw-XML line+arrowhead — no connector, avoids PPTX corruption."""
    l = min(x1, x2); t = min(y1, y2)
    W = max(abs(x2 - x1), Inches(0.01))
    H = max(abs(y2 - y1), Inches(0.01))
    sx = x1 - l; sy = y1 - t
    ex = x2 - l; ey = y2 - t
    xml = (
        f'<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
        f' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
        f' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<p:nvSpPr><p:cNvPr id="9001" name="ln"/>'
        f'<p:cNvSpPr><a:spLocks noChangeArrowheads="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>'
        f'<p:spPr>'
        f'<a:xfrm><a:off x="{int(l)}" y="{int(t)}"/><a:ext cx="{int(W)}" cy="{int(H)}"/></a:xfrm>'
        f'<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>'
        f'<a:rect l="0" t="0" r="0" b="0"/>'
        f'<a:pathLst><a:path w="{int(W)}" h="{int(H)}">'
        f'<a:moveTo><a:pt x="{int(sx)}" y="{int(sy)}"/></a:moveTo>'
        f'<a:lnTo><a:pt x="{int(ex)}" y="{int(ey)}"/></a:lnTo>'
        f'</a:path></a:pathLst></a:custGeom>'
        f'<a:ln w="{int(w * 12700)}">'
        f'<a:solidFill><a:srgbClr val="{_rgb_hex(color)}"/></a:solidFill>'
        f'<a:headEnd type="none"/><a:tailEnd type="arrow" w="med" len="med"/>'
        f'</a:ln></p:spPr>'
        f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>'
    )
    slide.shapes._spTree.append(etree.fromstring(xml))

def varrow(slide, x, y1, y2, color=BLUE_LIGHT, w=1.5):
    line_arrow(slide, x, y1, x, y2, color=color, w=w)

def harrow(slide, x1, y, x2, color=BLUE_LIGHT, w=1.5):
    line_arrow(slide, x1, y, x2, y, color=color, w=w)


# ═════════════════════════════════════════════════════════════════════════════
# SLIDE 1 — VERTICAL SINGLE-COLUMN WORKFLOW
# ═════════════════════════════════════════════════════════════════════════════

def build_slide1(prs):
    slide = blank_slide(prs)
    fill_bg(slide, DARK_BG)

    # ── Header ────────────────────────────────────────────────────────────────
    rect(slide, 0, 0, SLIDE_W, Inches(0.52), fill=PANEL_BG)
    txt(slide, Inches(0.3), Inches(0.08), Inches(9), Inches(0.38),
        "TSW Nomination ETA Agent — End-to-End Workflow",
        size=Pt(16), bold=True, color=TEXT_WHITE)
    txt(slide, Inches(11.0), Inches(0.13), Inches(2.1), Inches(0.28),
        "9-Step • Supervisor-Gated", size=Pt(8.5), color=TEXT_GRAY, align=PP_ALIGN.RIGHT)

    # ── Card geometry ─────────────────────────────────────────────────────────
    COL_X   = Inches(3.9)    # left edge of central column
    CARD_W  = Inches(5.5)    # card width
    CARD_H  = Inches(0.63)   # card height (compact to fit 7 + fork)
    CARD_CX = COL_X + CARD_W / 2

    START_Y = Inches(0.58)
    GAP     = Inches(0.11)

    steps_1_7 = [
        (BLUE_LIGHT, S4_BLUE,    "STEP 1", "Fetch Nomination from S/4HANA",
         "get_nomination / list_nominations  ·  OData POST → ZTANK_DIP_SRV_SRV/NominationSet via CAP"
         "  ·  Extracts: Location, Material, Transport, Scheduled Date, Carrier"),
        (BLUE_LIGHT, AIS_GREEN,  "STEP 2", "Live Vessel Tracking (AIS)",
         "get_port_vessel_etas(UN/LOCODE)  +  myshiptracking_lookup(vessel, IMO)"
         "  ·  MyShipTracking REST v2  ·  Returns: live_eta_utc in real-time"),
        (BLUE_LIGHT, YELLOW,     "STEP 3", "Historical Lead-Time Patterns",
         "get_nomination_history(material, location, transport)"
         "  ·  Computes avg / min / max / median lead time  ·  Flags ANOMALY if new lane"),
        (YELLOW, RGBColor(0x79,0xC0,0xFF), "STEP 4", "Carrier Performance Analysis",
         "analyze_carrier_performance(carrier)"
         "  ·  avg delay days, on-time %, risk rating: RELIABLE / MINOR / MODERATE / HIGH_RISK"),
        (YELLOW, GDELT_YELLOW, "STEP 5", "Geopolitical Risk Intelligence",
         "get_geopolitical_risk  ·  GDELT v2 free API · last 30 days"
         "  ·  Scans: strikes, hurricanes, sanctions, closures  ·  Returns: None/Low/Medium/High + delay days"),
        (YELLOW, BORDER_BLUE,  "STEP 6", "Calculate Risk-Adjusted ETA",
         "calculate_eta_intelligence  ·  Priority: Live AIS > Historical > Scheduled"
         "  ·  Carrier + Seasonal + Geo adjustments  ·  Outputs: ETA date + Confidence level"),
        (GREEN,  GREEN,        "STEP 7", "Present ETA Report — Await Supervisor Decision",
         "Full Markdown report: Base ETA · Adjustments table · Confidence · Data sources"
         "  ·  Supervisor prompted: APPROVE or REJECT?"),
    ]

    positions = {}

    for i, (lbl_clr, title_clr, step_lbl, title, body) in enumerate(steps_1_7):
        cy = START_Y + i * (CARD_H + GAP)
        positions[i] = (COL_X, cy)

        rect(slide, COL_X, cy, CARD_W, CARD_H,
             fill=PANEL_BG, line=RGBColor(0x30, 0x36, 0x3D))

        # Badge
        bw = Inches(0.52); bh = Inches(0.18)
        badge_col = GREEN if i == 6 else BORDER_BLUE
        rect(slide, COL_X + Inches(0.1), cy + Inches(0.08), bw, bh, fill=badge_col)
        txt(slide, COL_X + Inches(0.1), cy + Inches(0.08), bw, bh,
            step_lbl, size=Pt(6.5), bold=True, color=TEXT_WHITE, align=PP_ALIGN.CENTER)

        # Title
        txt(slide, COL_X + Inches(0.7), cy + Inches(0.06),
            CARD_W - Inches(0.8), Inches(0.22),
            title, size=Pt(9.5), bold=True, color=title_clr)

        # Body
        txt(slide, COL_X + Inches(0.7), cy + Inches(0.29),
            CARD_W - Inches(0.8), Inches(0.32),
            body, size=Pt(7.5), color=TEXT_GRAY, wrap=True)

    # Connecting arrows Steps 1-7
    arrow_colors = [BLUE_LIGHT, BLUE_LIGHT, BLUE_LIGHT, YELLOW, YELLOW, GREEN]
    for i in range(6):
        _, cy_cur = positions[i]
        _, cy_nxt = positions[i + 1]
        varrow(slide, CARD_CX, cy_cur + CARD_H, cy_nxt, color=arrow_colors[i], w=1.8)

    # ── Decision fork after Step 7 ────────────────────────────────────────────
    _, cy7     = positions[6]
    spine_bot  = cy7 + CARD_H + Inches(0.08)   # bottom of spine segment
    FORK_H     = Inches(0.88)
    FORK_W     = Inches(4.5)
    FORK_Y     = spine_bot + Inches(0.2)        # top of approve/reject cards

    approve_x  = Inches(0.18)
    reject_x   = SLIDE_W - FORK_W - Inches(0.18)
    approve_cx = approve_x + FORK_W / 2
    reject_cx  = reject_x  + FORK_W / 2

    # Spine down from Step 7 bottom
    varrow(slide, CARD_CX, cy7 + CARD_H, FORK_Y - Inches(0.08), color=GREEN, w=1.8)

    # Horizontal branches
    harrow(slide, CARD_CX, FORK_Y - Inches(0.08), approve_cx, color=GREEN, w=1.8)
    harrow(slide, CARD_CX, FORK_Y - Inches(0.08), reject_cx,  color=RED,   w=1.8)

    # Vertical drops into cards
    varrow(slide, approve_cx, FORK_Y - Inches(0.08), FORK_Y, color=GREEN, w=1.8)
    varrow(slide, reject_cx,  FORK_Y - Inches(0.08), FORK_Y, color=RED,   w=1.8)

    # Labels on branches
    txt(slide, approve_cx - Inches(1.1), FORK_Y - Inches(0.22),
        Inches(1.0), Inches(0.18), "APPROVE",
        size=Pt(7.5), bold=True, color=GREEN, align=PP_ALIGN.CENTER)
    txt(slide, reject_cx + Inches(0.1), FORK_Y - Inches(0.22),
        Inches(0.9), Inches(0.18), "REJECT",
        size=Pt(7.5), bold=True, color=RED, align=PP_ALIGN.CENTER)

    # APPROVE card (Step 8A)
    rect(slide, approve_x, FORK_Y, FORK_W, FORK_H,
         fill=PANEL_BG, line=RGBColor(0x23, 0x86, 0x36), lw=Pt(1.5))
    rect(slide, approve_x + Inches(0.1), FORK_Y + Inches(0.07),
         Inches(0.62), Inches(0.18), fill=RGBColor(0x23, 0x86, 0x36))
    txt(slide, approve_x + Inches(0.1), FORK_Y + Inches(0.07),
        Inches(0.62), Inches(0.18), "STEP 8A",
        size=Pt(6.5), bold=True, color=TEXT_WHITE, align=PP_ALIGN.CENTER)
    txt(slide, approve_x + Inches(0.78), FORK_Y + Inches(0.05),
        FORK_W - Inches(0.88), Inches(0.22),
        "Approved → Commit Events", size=Pt(9.5), bold=True, color=GREEN)
    txt(slide, approve_x + Inches(0.78), FORK_Y + Inches(0.28),
        FORK_W - Inches(0.88), Inches(0.34),
        "update_nomination_eta  ·  update_nomination_events"
        "  ·  Events: Loading → Berthing → Discharge → Departure  ·  Writes to S/4HANA via CAP",
        size=Pt(7.5), color=TEXT_GRAY, wrap=True)
    # Write-back dot
    wb_y = FORK_Y + FORK_H - Inches(0.2)
    dot(slide, approve_x + Inches(0.12), wb_y + Inches(0.02), LIGHT_PINK, size=Inches(0.1))
    txt(slide, approve_x + Inches(0.26), wb_y,
        FORK_W - Inches(0.35), Inches(0.17),
        "Write-back: CAP → S/4HANA OGS (ZTANK_DIP_SRV_SRV)",
        size=Pt(7), color=LIGHT_PINK)

    # REJECT card (Step 8B)
    rect(slide, reject_x, FORK_Y, FORK_W, FORK_H,
         fill=PANEL_BG, line=RGBColor(0xDA, 0x36, 0x33), lw=Pt(1.5))
    rect(slide, reject_x + Inches(0.1), FORK_Y + Inches(0.07),
         Inches(0.62), Inches(0.18), fill=RGBColor(0xDA, 0x36, 0x33))
    txt(slide, reject_x + Inches(0.1), FORK_Y + Inches(0.07),
        Inches(0.62), Inches(0.18), "STEP 8B",
        size=Pt(6.5), bold=True, color=TEXT_WHITE, align=PP_ALIGN.CENTER)
    txt(slide, reject_x + Inches(0.78), FORK_Y + Inches(0.05),
        FORK_W - Inches(0.88), Inches(0.22),
        "Rejected → Reassess & Alternatives", size=Pt(9.5), bold=True, color=RED)
    txt(slide, reject_x + Inches(0.78), FORK_Y + Inches(0.28),
        FORK_W - Inches(0.88), Inches(0.56),
        "record_rejection_reason  ·  get_nomination_history_deep"
        " (recency+seasonal weighting, supervisor hint)"
        "  ·  3 alternatives: Conservative / Moderate / Optimistic",
        size=Pt(7.5), color=TEXT_GRAY, wrap=True)

    # ── Legend ────────────────────────────────────────────────────────────────
    leg_y = FORK_Y + FORK_H + Inches(0.1)
    items = [
        (BLUE_LIGHT,  "Data Gathering (Steps 1–3)"),
        (YELLOW,      "Analysis (Steps 4–6)"),
        (GREEN,       "Approved / Commit"),
        (RED,         "Rejected / Reassess"),
        (AIS_GREEN,   "AIS live vessel tracking"),
        (LIGHT_PINK,  "Write-back to S/4HANA"),
    ]
    lx = Inches(1.0)
    for dc, lbl in items:
        dot(slide, lx, leg_y + Inches(0.03), dc)
        txt(slide, lx + Inches(0.14), leg_y, Inches(1.95), Inches(0.19),
            lbl, size=Pt(7.5), color=TEXT_DIM)
        lx += Inches(1.95)

    return slide


# ═════════════════════════════════════════════════════════════════════════════
# SLIDE 2 — ARCHITECTURE  (V5 layout — unchanged)
# ═════════════════════════════════════════════════════════════════════════════

def build_slide2(prs):
    slide = blank_slide(prs)
    fill_bg(slide, DARK_BG)

    # ── Header ────────────────────────────────────────────────────────────────
    rect(slide, 0, 0, SLIDE_W, Inches(0.52), fill=PANEL_BG)
    txt(slide, Inches(0.3), Inches(0.08), Inches(9), Inches(0.38),
        "TSW ETA Agent — Complete Architecture",
        size=Pt(16), bold=True, color=TEXT_WHITE)
    txt(slide, Inches(10.3), Inches(0.13), Inches(2.8), Inches(0.28),
        "CF · AI Core · A2A · LangGraph", size=Pt(8.5), color=TEXT_GRAY, align=PP_ALIGN.RIGHT)

    # ── Column geometry ────────────────────────────────────────────────────────
    COL_W   = Inches(4.11)
    COL_GAP = Inches(0.25)
    COL1_X  = Inches(0.25)
    COL2_X  = COL1_X + COL_W + COL_GAP
    COL3_X  = COL2_X + COL_W + COL_GAP
    COL_TOP = Inches(0.6)

    def col_header(x, label, color):
        txt(slide, x, COL_TOP, COL_W, Inches(0.24),
            label, size=Pt(9), bold=True, color=color, align=PP_ALIGN.CENTER)

    col_header(COL1_X, "EXTERNAL DATA SOURCES",  RGBColor(0x6E, 0x76, 0x81))
    col_header(COL2_X, "AGENT CORE",             BLUE_LIGHT)
    col_header(COL3_X, "SAP BTP PLATFORM",       RGBColor(0x6E, 0x76, 0x81))

    INNER_Y = COL_TOP + Inches(0.3)

    # ── Column 1 : External Sources ───────────────────────────────────────────
    s4_h = Inches(1.48)
    rect(slide, COL1_X, INNER_Y, COL_W, s4_h, fill=PANEL_BG, line=S4_BLUE, lw=Pt(1.5))
    txt(slide, COL1_X + Inches(0.12), INNER_Y + Inches(0.08),
        COL_W - Inches(0.2), Inches(0.24),
        "S/4HANA OGS (TSW)", size=Pt(10), bold=True, color=RGBColor(0x79, 0xC0, 0xFF))
    for l, by in zip(
        ["Protocol: OData POST (via CAP Backend)",
         "Service: ZTANK_DIP_SRV_SRV / NominationSet",
         "/reconciliation/getOpenNominations",
         "/createNomination  (BAPI_TSW_NOM_CREATE)"],
        [INNER_Y + Inches(0.35 + i*0.18) for i in range(4)]
    ):
        txt(slide, COL1_X + Inches(0.14), by, COL_W - Inches(0.24), Inches(0.18),
            l, size=Pt(8.2), color=TEXT_GRAY)

    ais_y = INNER_Y + s4_h + Inches(0.15)
    ais_h = Inches(1.48)
    rect(slide, COL1_X, ais_y, COL_W, ais_h, fill=PANEL_BG, line=AIS_GREEN, lw=Pt(1.5))
    txt(slide, COL1_X + Inches(0.12), ais_y + Inches(0.08),
        COL_W - Inches(0.2), Inches(0.24),
        "MyShipTracking (AIS)", size=Pt(10), bold=True, color=AIS_GREEN)
    for l, by in zip(
        ["Protocol: REST HTTPS — Bearer token (MST_API_KEY)",
         "api.myshiptracking.com/api/v2",
         "/port/estimate  — vessels arriving at port",
         "/vessel/search  — lookup vessel by name + IMO"],
        [ais_y + Inches(0.35 + i*0.18) for i in range(4)]
    ):
        txt(slide, COL1_X + Inches(0.14), by, COL_W - Inches(0.24), Inches(0.18),
            l, size=Pt(8.2), color=TEXT_GRAY)

    gd_y = ais_y + ais_h + Inches(0.15)
    gd_h = Inches(1.48)
    rect(slide, COL1_X, gd_y, COL_W, gd_h, fill=PANEL_BG, line=GDELT_YELLOW, lw=Pt(1.5))
    txt(slide, COL1_X + Inches(0.12), gd_y + Inches(0.08),
        COL_W - Inches(0.2), Inches(0.24),
        "GDELT Project v2", size=Pt(10), bold=True, color=GDELT_YELLOW)
    for l, by in zip(
        ["Protocol: REST HTTPS — free public API",
         "api.gdeltproject.org/api/v2/doc/doc",
         "Scans: last 30 days · port + oil + gas keywords",
         "No auth required · graceful fallback on rate-limit"],
        [gd_y + Inches(0.35 + i*0.18) for i in range(4)]
    ):
        txt(slide, COL1_X + Inches(0.14), by, COL_W - Inches(0.24), Inches(0.18),
            l, size=Pt(8.2), color=TEXT_GRAY)

    mid_s4  = INNER_Y + s4_h / 2
    mid_ais = ais_y   + ais_h / 2
    mid_gd  = gd_y    + gd_h  / 2
    harrow(slide, COL1_X + COL_W, mid_s4,  COL2_X, color=S4_BLUE,      w=1.5)
    harrow(slide, COL1_X + COL_W, mid_ais, COL2_X, color=AIS_GREEN,    w=1.5)
    harrow(slide, COL1_X + COL_W, mid_gd,  COL2_X, color=GDELT_YELLOW, w=1.5)
    harrow(slide, COL2_X, mid_s4 - Inches(0.12), COL1_X + COL_W,
           color=LIGHT_PINK, w=1.2)

    # ── Column 2 : Agent Core ─────────────────────────────────────────────────
    # Outer box drawn AFTER content so agent_box_h is computed from actual content
    # (placeholder height used for layout; box is inserted behind content via spTree)
    agent_box_h = None  # will be set after tools/supervisor are placed

    txt(slide, COL2_X, INNER_Y + Inches(0.08), COL_W, Inches(0.26),
        "Nomination ETA Proposal Agent", size=Pt(11), bold=True,
        color=BLUE_LIGHT, align=PP_ALIGN.CENTER)
    txt(slide, COL2_X, INNER_Y + Inches(0.34), COL_W, Inches(0.18),
        "nomination-eta-agent.cfapps.us10  ·  Port 5000  ·  Python 3.12  ·  256M",
        size=Pt(7.5), color=TEXT_DIM, align=PP_ALIGN.CENTER)
    txt(slide, COL2_X, INNER_Y + Inches(0.50), COL_W, Inches(0.18),
        "Gunicorn + UvicornWorker  ·  timeout 300s  ·  health /.well-known/agent.json",
        size=Pt(7.5), color=TEXT_DIM, align=PP_ALIGN.CENTER)

    int_y = INNER_Y + Inches(0.72)
    int_w = COL_W - Inches(0.28)
    int_x = COL2_X + Inches(0.14)
    int_h = Inches(0.7)

    layers = [
        (BORDER_BLUE, "A2A SDK — Protocol Layer",
         ["AgentCard  /.well-known/agent.json · streaming enabled",
          "InMemoryTaskStore · JWT middleware (Joule / BTP callers)"]),
        (BORDER_BLUE, "LangGraph ReAct Agent",
         ["create_react_agent(llm, tools, MemorySaver)",
          "Async streaming · Thread TTL: 1 hour · 9-step system prompt"]),
        (BORDER_BLUE, "SAP AI Core — LLM",
         ["Model: gpt-4o  ·  Temperature: 0.0  ·  max_tokens: 4096",
          "Destination: aicore  ·  Fallback: LiteLLM if AI Core unavailable"]),
    ]
    for bc, title, body in layers:
        rect(slide, int_x, int_y, int_w, int_h, fill=DARK_BG, line=bc)
        txt(slide, int_x + Inches(0.1), int_y + Inches(0.07),
            int_w - Inches(0.15), Inches(0.2),
            title, size=Pt(9), bold=True, color=RGBColor(0x79, 0xC0, 0xFF))
        by = int_y + Inches(0.3)
        for l in body:
            txt(slide, int_x + Inches(0.1), by, int_w - Inches(0.15), Inches(0.18),
                l, size=Pt(7.8), color=TEXT_GRAY)
            by += Inches(0.18)
        varrow(slide, int_x + int_w / 2, int_y + int_h,
               int_y + int_h + Inches(0.06), color=BLUE_LIGHT, w=1.2)
        int_y += int_h + Inches(0.1)

    tools_y = int_y + Inches(0.02)
    txt(slide, int_x, tools_y, int_w, Inches(0.2),
        "13 LangChain Structured Tools:", size=Pt(8), bold=True, color=TEXT_GRAY)

    tools = [
        ("list_nominations",            "List open TSW nominations"),
        ("get_nomination",              "Fetch nomination by number"),
        ("get_port_vessel_etas",        "Live ETAs at port (UN/LOCODE)"),
        ("myshiptracking_lookup",       "Vessel name + IMO → live ETA"),
        ("get_nomination_history",      "Lead time stats: avg/min/max"),
        ("get_nomination_history_deep", "Recency-weighted deep analysis"),
        ("get_geopolitical_risk",       "GDELT scan → risk + delay buf"),
        ("analyze_carrier_performance", "Carrier delay avg, on-time %"),
        ("calculate_eta_intelligence",  "Combine all → ETA + confidence"),
        ("record_rejection_reason",     "Log supervisor rejection note"),
        ("update_nomination_eta",       "Write approved ETA → S/4HANA"),
        ("update_nomination_events",    "Write Loading/Berthing/Discharge"),
        ("create_nomination",           "Create nomination in S/4HANA"),
    ]

    # 13 tools in 2 columns = 7 rows; compute actual grid height first,
    # then pin the supervisor box below the grid with a fixed gap.
    TCOLS   = 2
    tool_w  = (int_w - Inches(0.06)) / TCOLS
    tool_h  = Inches(0.33)   # slightly shorter chips so all 7 rows fit
    tool_gap = Inches(0.025)
    tool_sy = tools_y + Inches(0.22)
    tool_rows = -(-len(tools) // TCOLS)  # ceiling division
    grid_bottom = tool_sy + tool_rows * (tool_h + tool_gap) - tool_gap

    for idx, (name, desc) in enumerate(tools):
        col = idx % TCOLS
        row = idx // TCOLS
        tx = int_x + col * (tool_w + Inches(0.06))
        ty = tool_sy + row * (tool_h + tool_gap)
        rect(slide, tx, ty, tool_w, tool_h,
             fill=RGBColor(0x21, 0x26, 0x2D), line=RGBColor(0x30, 0x36, 0x3D))
        txt(slide, tx + Inches(0.06), ty + Inches(0.03),
            tool_w - Inches(0.1), Inches(0.17),
            name, size=Pt(7), bold=True,
            color=RGBColor(0x79, 0xC0, 0xFF), font="Consolas", wrap=False)
        txt(slide, tx + Inches(0.06), ty + Inches(0.175),
            tool_w - Inches(0.1), Inches(0.14),
            desc, size=Pt(6.5), color=TEXT_GRAY, wrap=True)

    # Supervisor box: always starts 0.1" below the last tool row
    sv_w = COL_W - Inches(0.28); sv_h = Inches(0.36)
    sv_x = int_x
    sv_y = grid_bottom + Inches(0.1)
    rect(slide, sv_x, sv_y, sv_w, sv_h,
         fill=RGBColor(0x16, 0x1B, 0x22), line=GREEN, lw=Pt(1.5))
    txt(slide, sv_x, sv_y + Inches(0.04), sv_w, Inches(0.18),
        "Supervisor / Joule — Approve or Reject every ETA",
        size=Pt(8.5), bold=True, color=GREEN, align=PP_ALIGN.CENTER)
    txt(slide, sv_x, sv_y + Inches(0.2), sv_w, Inches(0.14),
        "Human-in-the-loop · No write-back without approval",
        size=Pt(7.5), color=TEXT_DIM, align=PP_ALIGN.CENTER)

    # Extend the agent outer box to contain everything
    agent_box_h = sv_y + sv_h - INNER_Y + Inches(0.12)

    # Draw outer agent box behind all content (insert at position 2 in spTree, behind everything)
    _box = rect(slide, COL2_X, INNER_Y, COL_W, agent_box_h,
                fill=PANEL_BG, line=BORDER_BLUE, lw=Pt(2))
    # Move the box shape to just after the background (index 0) so it sits behind text
    spTree = slide.shapes._spTree
    sp_elem = _box._element
    spTree.remove(sp_elem)
    spTree.insert(2, sp_elem)

    # ── Column 3 : SAP BTP Platform ───────────────────────────────────────────
    plat_items = [
        (PURPLE,                   "SAP AI Core",
         ["Model: GPT-4o  ·  Temp 0.0  ·  max_tokens 4096",
          "Destination name: aicore (CF Destination Svc)",
          "LiteLLM fallback if AI Core unavailable"]),
        (RGBColor(0x79,0xC0,0xFF), "CAP Backend (Node.js)",
         ["tank-reconciliation-cap-srv",
          "OData proxy — routes calls to S/4HANA OGS",
          "/getOpenNominations  ·  /createNomination"]),
        (TEXT_GRAY,                "CF Destination Service",
         ["proj-vector-destination-service (VCAP_SERVICES)",
          "Resolves: S/4HANA endpoint + credentials",
          "Resolves: SAP AI Core endpoint + credentials"]),
        (YELLOW,                   "MCP Server (optional)",
         ["nomination-mcp-server.cfapps.us10.hana.ondemand.com",
          "Extra tools via Model Context Protocol",
          "Loaded when NOMINATION_MCP_SERVER_URL set"]),
    ]

    py = INNER_Y
    ph = (agent_box_h - Inches(0.45)) / len(plat_items)
    for i, (bc, title, body) in enumerate(plat_items):
        card_y = py + i * ph
        card_h = ph - Inches(0.1)
        rect(slide, COL3_X, card_y, COL_W, card_h, fill=PANEL_BG, line=bc, lw=Pt(1.5))
        txt(slide, COL3_X + Inches(0.12), card_y + Inches(0.08),
            COL_W - Inches(0.2), Inches(0.24),
            title, size=Pt(10), bold=True, color=bc)
        by = card_y + Inches(0.35)
        for l in body:
            txt(slide, COL3_X + Inches(0.14), by, COL_W - Inches(0.24), Inches(0.18),
                l, size=Pt(8.2), color=TEXT_GRAY)
            by += Inches(0.18)

    mid_c2 = INNER_Y + agent_box_h / 2
    harrow(slide, COL2_X + COL_W, mid_c2, COL3_X, color=BLUE_LIGHT, w=1.5)
    plat_mids = [INNER_Y + i * ph + ph / 2 for i in range(len(plat_items))]
    for i, (bc, _, _) in enumerate(plat_items):
        harrow(slide, COL2_X + COL_W + Inches(0.05), plat_mids[i],
               COL3_X - Inches(0.05), color=bc, w=0.8)

    # ── Legend ────────────────────────────────────────────────────────────────
    leg_y = INNER_Y + agent_box_h + Inches(0.15)
    items = [
        (S4_BLUE,      "S/4HANA OData (read)"),
        (LIGHT_PINK,   "Write-back to S/4HANA"),
        (AIS_GREEN,    "AIS live vessel data"),
        (GDELT_YELLOW, "GDELT news risk"),
        (PURPLE,       "SAP AI Core / LLM"),
        (GREEN,        "Supervisor Approval Gate"),
    ]
    lx = Inches(0.3)
    for dc, lbl in items:
        dot(slide, lx, leg_y + Inches(0.03), dc)
        txt(slide, lx + Inches(0.14), leg_y, Inches(2.0), Inches(0.19),
            lbl, size=Pt(7.5), color=TEXT_DIM)
        lx += Inches(2.18)

    return slide


# ── Main ──────────────────────────────────────────────────────────────────────

OUT = "/Users/i023725/Desktop/New_TSW_ETA_Agent_Slides.pptx"
prs = new_prs()
build_slide1(prs)
build_slide2(prs)
prs.save(OUT)
print(f"Saved: {OUT}")
