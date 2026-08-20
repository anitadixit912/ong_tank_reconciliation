"""Nomination MCP Server — exposes nomination tools via MCP protocol over HTTP/SSE.

Tools exposed:
  - list_nominations         : All open nominations from S/4HANA OGS NominationSet
  - get_nomination           : Single nomination enriched with vessel details via BAPI_TSW_NOM_GETLIST
  - get_port_vessel_etas     : Live AIS vessel ETAs at a port (MyShipTracking)
  - get_nomination_history   : Historical nominations by material+location+transport
  - search_vessel            : Search vessel by name on MyShipTracking
"""

from __future__ import annotations

import json
import logging
import os
import statistics
from datetime import datetime
from typing import Any

import httpx
from mcp.server.mcpserver.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "").rstrip("/")
S4_DESTINATION = os.environ.get("S4HANA_DESTINATION_NAME", "OGS_S4")
MST_API_KEY = os.environ.get("MST_API_KEY", "")
MST_BASE_URL = "https://api.myshiptracking.com/api/v2"
_TIMEOUT = 20.0

# ── MCP server instance ───────────────────────────────────────────────────────
_public_url = os.environ.get("MCP_SERVER_PUBLIC_URL", "https://nomination-mcp-server.cfapps.us10.hana.ondemand.com")
_host = _public_url.replace("https://", "").replace("http://", "").rstrip("/")

mcp = MCPServer(
    "Nomination MCP Server",
    description="Exposes nomination tools: list/get nominations from S/4HANA OGS, live vessel ETAs from MyShipTracking, nomination history.",
    auth=None,
    middleware=[],
    extensions=[],
    tools=[],
)


# ── S/4HANA helpers ──────────────────────────────────────────────────────────

async def _cap_post(path: str, payload: dict = {}) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            f"{CAP_BASE_URL}{path}",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()


async def _fetch_all_nominations() -> list[dict]:
    data = await _cap_post("/reconciliation/getOpenNominations")
    return data.get("value", [])


def _normalize_nom(nomination_number: str) -> str:
    stripped = nomination_number.strip().lstrip("0")
    try:
        int(stripped)
        return nomination_number.strip().zfill(20)
    except ValueError:
        return nomination_number.strip()


async def _enrich_with_bapi(nomination_number: str) -> dict:
    """Call BAPI_TSW_NOM_GETLIST via CAP proxy to get vessel details."""
    try:
        # CAP getOpenNominations proxies ZTANK_DIP_SRV_SRV which lacks vessel fields.
        # Try fetching individual nomination via OData — if vessel fields exposed, use them.
        # Otherwise return empty enrichment (ABAP extension pending).
        return {}
    except Exception as e:
        logger.warning("BAPI enrichment failed: %s", e)
        return {}


# ── MST helpers ───────────────────────────────────────────────────────────────

async def _mst_get(path: str, params: dict = {}) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(
            f"{MST_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {MST_API_KEY}"},
            params=params,
        )
        r.raise_for_status()
        return r.json()


# ── MCP Tools ─────────────────────────────────────────────────────────────────

@mcp.tool()
async def list_nominations() -> str:
    """List all open nominations from S/4HANA OGS.
    Returns nomination number, material, location, transport system, scheduled date and status."""
    try:
        nominations = await _fetch_all_nominations()
        if not nominations:
            return json.dumps({"found": False, "message": "No open nominations found."})
        summary = [
            {
                "nomination_number": n.get("Nominationnumber", "").strip(),
                "material": n.get("Demandmaterial", ""),
                "location": n.get("Locationid", ""),
                "transport_system": n.get("Transportsystem", ""),
                "scheduled_date": n.get("Scheduleddate", ""),
                "quantity": f"{n.get('Nominatedqty', '')} {n.get('Quantityunit', '')}",
                "status": n.get("Nomstatus", ""),
            }
            for n in nominations
        ]
        return json.dumps({"found": True, "count": len(summary), "nominations": summary}, indent=2)
    except Exception as e:
        return f"Error listing nominations: {e}"


@mcp.tool()
async def get_nomination(nomination_number: str) -> str:
    """Retrieve a single nomination by nomination number, enriched with vessel details where available.
    Nomination numbers may be short (e.g. 128) or zero-padded (e.g. 00000000000000000128)."""
    try:
        normalized = _normalize_nom(nomination_number)
        nominations = await _fetch_all_nominations()
        match = next(
            (n for n in nominations if n.get("Nominationnumber", "").strip() == normalized),
            None,
        )
        if not match:
            available = [n.get("Nominationnumber", "").strip() for n in nominations]
            return json.dumps({
                "found": False,
                "nomination_number": nomination_number,
                "message": f"Nomination not found. Available nominations: {available}",
            })
        enrichment = await _enrich_with_bapi(normalized)
        result = {
            "found": True,
            "nomination_number": normalized,
            "material": match.get("Demandmaterial", ""),
            "location": match.get("Locationid", ""),
            "transport_system": match.get("Transportsystem", ""),
            "scheduled_date": match.get("Scheduleddate", ""),
            "quantity": f"{match.get('Nominatedqty', '')} {match.get('Quantityunit', '')}",
            "item_status": match.get("Itemstatus", ""),
            "nomination_status": match.get("Nomstatus", ""),
            # Vessel fields — populated once ABAP team extends NominationSet
            "vessel_name": enrichment.get("vessel_name") or match.get("Vesselname", ""),
            "imo_number": enrichment.get("imo_number") or match.get("Imonumber", ""),
            "origin_port": enrichment.get("origin_port") or match.get("Originport", ""),
            "destination_port": enrichment.get("destination_port") or match.get("Destinationport", ""),
            "vessel_data_note": (
                "Vessel name and IMO not yet available in NominationSet. "
                "Pending ABAP extension to expose WTMKO-SHIPNAME and WTMKO-IMO_NO."
            ) if not (enrichment or match.get("Vesselname")) else "",
        }
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error fetching nomination {nomination_number}: {e}"


@mcp.tool()
async def get_port_vessel_etas(unloco: str) -> str:
    """Get live ETA estimates for ALL vessels heading to a specific port using real-time AIS data.
    Use port UN/LOCODE (e.g. USMOB for Mobile Alabama, USHOU for Houston, USNOL for New Orleans).
    This is the PRIMARY intelligence source for ETA prediction."""
    try:
        if not MST_API_KEY:
            return json.dumps({"error": "MST_API_KEY not configured."})
        data = await _mst_get("/port/estimate", {"unloco": unloco})
        vessels = data.get("data", [])
        if not vessels:
            return json.dumps({"found": False, "unloco": unloco, "message": "No vessels with ETA found for this port."})
        return json.dumps({
            "found": True,
            "unloco": unloco,
            "total_vessels": len(vessels),
            "vessels": [
                {
                    "vessel_name": v.get("vessel_name"),
                    "imo": v.get("imo"),
                    "mmsi": v.get("mmsi"),
                    "vessel_type": v.get("vessel_type"),
                    "flag": v.get("flag"),
                    "eta_utc": v.get("eta_utc"),
                    "eta_local": v.get("eta_local"),
                    "current_area": v.get("area"),
                }
                for v in vessels
            ],
        }, indent=2)
    except Exception as e:
        return f"Error fetching port vessel ETAs for {unloco}: {e}"


@mcp.tool()
async def search_vessel(vessel_name: str, imo_number: str = "", destination_unloco: str = "") -> str:
    """Search for a vessel by name on MyShipTracking and get its live ETA at a destination port.
    Optionally provide IMO number to match exactly. Provide destination_unloco to get live port ETA."""
    try:
        if not MST_API_KEY:
            return json.dumps({"error": "MST_API_KEY not configured."})
        data = await _mst_get("/vessel/search", {"name": vessel_name})
        vessels = data.get("data", [])
        if not vessels:
            return json.dumps({"found": False, "message": f"No vessel found matching '{vessel_name}'."})
        matched = next(
            (v for v in vessels if imo_number and str(v.get("imo", "")).strip() == str(imo_number).strip()),
            vessels[0],
        )
        mmsi = matched.get("mmsi")
        port_eta = None
        if destination_unloco and mmsi:
            try:
                port_data = await _mst_get("/port/estimate", {"unloco": destination_unloco})
                port_eta = next((v for v in port_data.get("data", []) if v.get("mmsi") == mmsi), None)
            except Exception:
                pass
        result = {
            "found": True,
            "vessel_name": matched.get("vessel_name"),
            "imo": matched.get("imo"),
            "mmsi": mmsi,
            "vessel_type": matched.get("vessel_type"),
            "flag": matched.get("flag"),
            "current_area": matched.get("area"),
        }
        if port_eta:
            result["live_eta"] = {
                "destination_port": destination_unloco,
                "eta_utc": port_eta.get("eta_utc"),
                "eta_local": port_eta.get("eta_local"),
            }
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error searching vessel '{vessel_name}': {e}"


@mcp.tool()
async def create_nomination(
    scheduled_date: str,
    location_id: str,
    material: str,
    quantity: float,
    quantity_unit: str,
    transport_system: str,
    item_type: str = "D",
) -> str:
    """Create a new nomination in S/4HANA OGS TSW.
    scheduled_date: ISO date (YYYY-MM-DD)
    location_id: UN/LOCODE or SAP location (e.g. USMOB)
    material: material/product code (e.g. BLK_GASOLINE 87)
    quantity: nominated quantity
    quantity_unit: unit of measure (BLL=barrels, TNE=tonnes)
    transport_system: transport system code (e.g. BARGE_1743)
    item_type: D=Demand, O=Order (default D)"""
    try:
        data = await _cap_post("/reconciliation/createNomination", {
            "Scheduleddate": scheduled_date,
            "Locationid": location_id,
            "Demandmaterial": material,
            "Nominatedqty": quantity,
            "Quantityunit": quantity_unit,
            "Transportsystem": transport_system,
            "Itemtype": item_type,
        })
        return json.dumps(data, indent=2)
    except Exception as e:
        return f"Error creating nomination: {e}"


@mcp.tool()
async def get_nomination_vessel_details(nomination_number: str, item_number: str = "0000000020") -> str:
    """Get vessel details (name, IMO, origin port, destination port) for a specific nomination
    by fetching the individual nomination entity from S/4HANA OGS.
    Returns vessel name and IMO number which can then be used for live MyShipTracking lookup."""
    try:
        normalized = nomination_number.strip().zfill(20) if nomination_number.strip().lstrip("0").isdigit() else nomination_number.strip()
        data = await _cap_post("/reconciliation/getNominationVesselDetails", {
            "nominationNumber": normalized,
            "itemNumber": item_number,
        })
        raw_json = data.get("rawJson", "{}")
        vessel_name = data.get("Vesselname", "")
        imo = data.get("Imonumber", "")
        origin = data.get("Originport", "")
        destination = data.get("Destinationport", "")

        if not vessel_name and not imo:
            import json as _json
            try:
                raw = _json.loads(raw_json)
                return json.dumps({
                    "found": False,
                    "nomination_number": normalized,
                    "message": "Vessel name and IMO not available in NominationSet. The S/4HANA OGS custom service (ZTANK_DIP_SRV_SRV) does not expose vessel fields yet.",
                    "all_fields_returned": list(raw.get("d", raw).keys()) if isinstance(raw.get("d", raw), dict) else [],
                    "note": "Request ABAP team to add WTMKO-SHIPNAME and WTMKO-IMO_NO fields to NominationSet entity in ZTANK_DIP_SRV_SRV.",
                })
            except Exception:
                pass

        return json.dumps({
            "found": True,
            "nomination_number": normalized,
            "vessel_name": vessel_name,
            "imo_number": imo,
            "call_sign": data.get("Callsign", ""),
            "origin_port": origin,
            "destination_port": destination,
        }, indent=2)
    except Exception as e:
        return f"Error fetching vessel details for nomination {nomination_number}: {e}"


@mcp.tool()
async def get_nomination_history(material: str, location: str, transport_system: str) -> str:
    """Get historical nominations for a material + location + transport system combination.
    Returns all matching records with scheduled dates, quantities, and basic statistics."""
    try:
        nominations = await _fetch_all_nominations()
        records = [
            n for n in nominations
            if n.get("Demandmaterial", "").strip() == material.strip()
            and n.get("Locationid", "").strip() == location.strip()
            and n.get("Transportsystem", "").strip() == transport_system.strip()
        ]
        if not records:
            return json.dumps({
                "found": False,
                "combination": {"material": material, "location": location, "transport_system": transport_system},
                "message": "No nominations found for this combination — may be a new lane or data entry error.",
            })
        scheduled_dates = [r.get("Scheduleddate", "") for r in records if r.get("Scheduleddate")]
        return json.dumps({
            "found": True,
            "combination": {"material": material, "location": location, "transport_system": transport_system},
            "total_records": len(records),
            "scheduled_dates": scheduled_dates,
            "note": "No completion dates available yet — lead time calculation not possible until S/4HANA exposes actual arrival dates.",
            "all_records": [
                {
                    "nomination_number": r.get("Nominationnumber", "").strip(),
                    "scheduled_date": r.get("Scheduleddate", ""),
                    "quantity": f"{r.get('Nominatedqty', '')} {r.get('Quantityunit', '')}",
                    "status": r.get("Nomstatus", ""),
                }
                for r in records
            ],
        }, indent=2)
    except Exception as e:
        return f"Error fetching nomination history: {e}"


# ── HTTP app (MCP over SSE + health endpoint) ─────────────────────────────────

async def health(request):
    return JSONResponse({"status": "ok", "service": "nomination-mcp-server"})


# Build Starlette app with MCP SSE transport + health route
# transport_security=None disables DNS rebinding protection for CF deployment
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
