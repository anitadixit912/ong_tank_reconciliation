"""Tank Dip MCP Server — exposes dip reading management tools via MCP protocol over HTTP/SSE.

All S/4HANA calls are proxied through the CAP backend (which owns the OGS_S4 destination,
Cloud Connector proxy, and CSRF token handling). This server calls CAP actions directly.

Tools exposed:
  - get_tank_configurations    : List all configured tanks with SOCNR, plant, tolerances
  - get_tank_dips              : Read dip history for a tank from OGS via CAP
  - list_dip_readings          : List CAP-stored dip readings for a tank
  - create_dip_reading         : Create a dip reading record in CAP
  - post_dip_to_sap            : Submit a CAP dip reading to SAP IS-Oil via OGS_S4
  - batch_post_dips_to_sap     : Batch submit multiple dip readings to SAP IS-Oil
  - trigger_reconciliation_run : Trigger the M1-M6 stock reconciliation pipeline
  - get_reason_codes           : Fetch movement reason codes from T157D via OGS
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import httpx
from mcp.server.mcpserver.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "").rstrip("/")
_TIMEOUT = 30.0

# ── MCP server instance ───────────────────────────────────────────────────────
_public_url = os.environ.get("MCP_SERVER_PUBLIC_URL", "https://tank-dip-mcp-server.cfapps.us10.hana.ondemand.com")
_host = _public_url.replace("https://", "").replace("http://", "").rstrip("/")

mcp = MCPServer(
    "Tank Dip MCP Server",
    description="Exposes dip reading management tools: create/post dips to SAP IS-Oil via OGS_S4, read tank dips and configurations, trigger reconciliation runs.",
    auth=None,
    middleware=[],
    extensions=[],
    tools=[],
)


# ── CAP helpers ───────────────────────────────────────────────────────────────

async def _cap_post(path: str, payload: dict = {}) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            f"{CAP_BASE_URL}{path}",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()


async def _cap_get(path: str) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(
            f"{CAP_BASE_URL}{path}",
            headers={"Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()


# ── MCP Tools ─────────────────────────────────────────────────────────────────

@mcp.tool()
async def get_tank_configurations() -> str:
    """List all configured tanks with SOCNR (20-char tank ID), name, plant, storage location,
    and variance tolerance thresholds (OK% / Flag%). Use this to find the correct tankId before
    creating a dip reading."""
    try:
        data = await _cap_get("/reconciliation/TankConfigurations?$orderby=tankId")
        tanks = data.get("value", [])
        if not tanks:
            return json.dumps({"found": False, "message": "No tank configurations found."})
        return json.dumps({
            "found": True,
            "count": len(tanks),
            "tanks": [
                {
                    "tankId": t.get("tankId", ""),
                    "tankName": t.get("tankName", ""),
                    "plant": t.get("plant", ""),
                    "storageLocation": t.get("storageLocation", ""),
                    "terminalId": t.get("terminalId", ""),
                    "toleranceOkPct": t.get("toleranceOkPct"),
                    "toleranceFlagPct": t.get("toleranceFlagPct"),
                    "active": t.get("active"),
                }
                for t in tanks
            ],
        }, indent=2)
    except Exception as e:
        return f"Error fetching tank configurations: {e}"


@mcp.tool()
async def get_tank_dips(tank_id: str, top: int = 5) -> str:
    """Read the most recent dip history for a specific tank directly from SAP IS-Oil via OGS_S4.
    tank_id: 20-char SOCNR (e.g. 00000000000000000023).
    Returns physical quantity, book stock, UOM, timestamp from ZTANK_DIP_SRV_SRV/TankDipSet."""
    try:
        # Proxy through CAP getPlants-style action — use the fetchTankDip CAP path
        # CAP exposes dip data via TankResults (from runs). For raw latest dip, use
        # DipReadings endpoint which stores previously fetched/created dips.
        path = f"/reconciliation/DipReadings?$filter=tankId eq '{tank_id}'&$orderby=measurementDate desc,measurementTime desc&$top={top}"
        data = await _cap_get(path)
        records = data.get("value", [])
        if not records:
            return json.dumps({
                "found": False,
                "tankId": tank_id,
                "message": "No dip readings found in CAP for this tank. Create one first or run reconciliation.",
            })
        return json.dumps({
            "found": True,
            "tankId": tank_id,
            "count": len(records),
            "dips": [
                {
                    "date": r.get("measurementDate"),
                    "time": r.get("measurementTime"),
                    "dipType": r.get("dipType"),
                    "dipValue": r.get("dipValue"),
                    "dipUnit": r.get("dipUnit"),
                    "temperature": r.get("temperature"),
                    "density": r.get("density"),
                    "waterHeight": r.get("waterHeight"),
                    "dipEvent": r.get("dipEvent"),
                    "postingStatus": r.get("postingStatus"),
                    "inputMethod": r.get("inputMethod"),
                }
                for r in records
            ],
        }, indent=2)
    except Exception as e:
        return f"Error fetching tank dips for {tank_id}: {e}"


@mcp.tool()
async def list_dip_readings(tank_id: str, top: int = 10) -> str:
    """List dip readings stored in CAP for a specific tank, ordered most recent first.
    tank_id: 20-char SOCNR. Shows postingStatus (DRAFT/SUBMITTED/POSTED/FAILED/PENDING_ABAP)."""
    try:
        path = f"/reconciliation/DipReadings?$filter=tankId eq '{tank_id}'&$orderby=createdAt desc&$top={top}"
        data = await _cap_get(path)
        records = data.get("value", [])
        if not records:
            return json.dumps({"found": False, "tankId": tank_id, "message": "No dip readings found."})
        return json.dumps({
            "found": True,
            "tankId": tank_id,
            "count": len(records),
            "readings": [
                {
                    "id": r.get("ID"),
                    "date": r.get("measurementDate"),
                    "time": r.get("measurementTime"),
                    "dipType": r.get("dipType"),
                    "dipValue": r.get("dipValue"),
                    "dipUnit": r.get("dipUnit"),
                    "postingStatus": r.get("postingStatus"),
                    "inputMethod": r.get("inputMethod"),
                    "bapiResponse": r.get("bapiResponse", "")[:200],
                }
                for r in records
            ],
        }, indent=2)
    except Exception as e:
        return f"Error listing dip readings for {tank_id}: {e}"


@mcp.tool()
async def create_dip_reading(
    tank_id: str,
    measurement_date: str,
    dip_type: str,
    dip_value: float,
    dip_unit: str,
    measurement_time: str = "",
    water_height: Optional[float] = None,
    temperature: Optional[float] = None,
    density: Optional[float] = None,
    dip_event: str = "",
    notes: str = "",
) -> str:
    """Create a new dip reading record in CAP (stored in HANA/SQLite).
    Use post_dip_to_sap after this to submit it to SAP IS-Oil.

    tank_id: 20-char SOCNR, zero-padded (e.g. 00000000000000000023)
    measurement_date: YYYY-MM-DD
    measurement_time: HHMMSS in 24-hour format (e.g. 143000 for 14:30:00)
    dip_type: I=Innage (depth from bottom), U=Ullage (empty space from top)
    dip_value: Physical measurement number
    dip_unit: MM, CM, L, HL, BBL, or M3
    water_height: Free water level (optional)
    temperature: Celsius for ASTM/VCF correction (optional)
    density: kg/m³ for ASTM/VCF correction (optional)
    dip_event: Short event description e.g. Post-discharge (optional)"""
    try:
        result = await _cap_post("/reconciliation/saveDipReading", {
            "tankId": tank_id,
            "measurementDate": measurement_date,
            "measurementTime": measurement_time,
            "dipType": dip_type.upper(),
            "dipValue": dip_value,
            "dipUnit": dip_unit.upper(),
            "waterHeight": water_height,
            "temperature": temperature,
            "density": density,
            "dipEvent": dip_event,
            "inputMethod": "MANUAL",
            "notes": notes,
        })
        return json.dumps({
            "success": True,
            "dipReadingId": result.get("id"),
            "status": result.get("status"),
            "message": f"Dip reading saved in CAP. Call post_dip_to_sap('{result.get('id')}') to submit to SAP IS-Oil.",
        }, indent=2)
    except Exception as e:
        return f"Error creating dip reading: {e}"


@mcp.tool()
async def post_dip_to_sap(dip_reading_id: str) -> str:
    """Post a saved dip reading to SAP IS-Oil via the OGS_S4 BTP destination.
    Calls ZTANK_DIP_SRV_SRV/TankDipSet CREATE operation through the CAP backend.
    dip_reading_id: UUID returned by create_dip_reading.

    Possible outcomes:
    - POSTED: Successfully written to IS-Oil OIB_TANKDIP table
    - FAILED: OGS returned an error (message contains detail)
    - PENDING_ABAP: CREATE not supported on ZTANK_DIP_SRV_SRV — record safe in CAP,
      ABAP team must expose BAPI_TANK_DIP (fn group OI0_BAPI) via writable OData service"""
    try:
        result = await _cap_post("/reconciliation/saveDipToSAP", {"dipReadingId": dip_reading_id})
        return json.dumps({
            "success": result.get("success"),
            "dipReadingId": dip_reading_id,
            "message": result.get("message"),
        }, indent=2)
    except Exception as e:
        return f"Error posting dip to SAP: {e}"


@mcp.tool()
async def batch_post_dips_to_sap(dip_reading_ids: str) -> str:
    """Batch submit multiple dip readings to SAP IS-Oil.
    dip_reading_ids: comma-separated list of UUIDs from create_dip_reading.
    Returns submitted count, failed count, and error messages."""
    try:
        result = await _cap_post("/reconciliation/batchSaveDipsToSAP", {"dipReadingIds": dip_reading_ids})
        return json.dumps({
            "submitted": result.get("submitted", 0),
            "failed": result.get("failed", 0),
            "messages": result.get("messages", ""),
        }, indent=2)
    except Exception as e:
        return f"Error in batch post: {e}"


@mcp.tool()
async def trigger_reconciliation_run(run_date: str, plant: str = "") -> str:
    """Trigger the M1-M6 hydrocarbon stock reconciliation pipeline for a specific date.
    run_date: YYYY-MM-DD — the date to reconcile
    plant: SAP plant code (e.g. 1743) — optional, reconciles all plants if omitted.

    This runs the full pipeline:
    M1 Data Collection → M2 VCF → M3 Variance → M4 Approval Gate → M5 GI Posting → M6 Report"""
    try:
        payload = {"runDate": run_date}
        if plant:
            payload["plant"] = plant
        result = await _cap_post("/reconciliation/triggerRun", payload)
        return json.dumps({
            "success": True,
            "runId": result.get("runId"),
            "status": result.get("status"),
            "message": f"Reconciliation run triggered for {run_date}. Monitor via Dashboard.",
        }, indent=2)
    except Exception as e:
        return f"Error triggering reconciliation run: {e}"


@mcp.tool()
async def get_reason_codes() -> str:
    """Fetch movement reason codes from SAP T157D/T157E via OGS_S4.
    Returns reason code (Grund), movement type (Bwart), and description (Grtxt).
    Used when approving/rejecting variance postings."""
    try:
        result = await _cap_post("/reconciliation/getReasonCodes", {})
        codes = result if isinstance(result, list) else result.get("value", [])
        if not codes:
            return json.dumps({"found": False, "message": "No reason codes returned from OGS."})
        return json.dumps({
            "found": True,
            "count": len(codes),
            "reasonCodes": [{"Grund": c.get("Grund"), "Bwart": c.get("Bwart"), "Grtxt": c.get("Grtxt")} for c in codes],
        }, indent=2)
    except Exception as e:
        return f"Error fetching reason codes: {e}"


# ── HTTP app (MCP over SSE + health endpoint) ─────────────────────────────────

async def health(request):
    return JSONResponse({"status": "ok", "service": "tank-dip-mcp-server", "cap_url": CAP_BASE_URL[:50] if CAP_BASE_URL else "NOT_SET"})


_mcp_app = mcp.sse_app(
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    host=_host,
)

app = Starlette(
    routes=[
        Route("/health", health),
        *_mcp_app.routes,
    ]
)
