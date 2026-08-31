"""LangChain tools for the Nomination ETA Proposal Agent.

All nomination data is fetched from the CAP backend via:
  POST /reconciliation/getOpenNominations  →  proxies to S/4HANA OGS ZTANK_DIP_SRV_SRV/NominationSet

NominationHistory is derived from the same source (completed nominations share the same
material + location + transport system combination).

Write-back (ETA update, events, rejection reason) is logged in-memory and returned to the
supervisor — a future sprint will wire these to the CAP write endpoints once the CDS
entities are defined.
"""

from __future__ import annotations

import json
import logging
import os
import statistics
from collections import defaultdict
from datetime import datetime
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "").rstrip("/")
MST_API_KEY = os.environ.get("MST_API_KEY", "")
MST_SECRET_KEY = os.environ.get("MST_SECRET_KEY", "")
MST_BASE_URL = "https://api.myshiptracking.com/api/v2"
_TIMEOUT = 20.0

_NOMINATIONS_ENDPOINT = "/reconciliation/getOpenNominations"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

async def _cap_post(path: str, payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            f"{CAP_BASE_URL}{path}",
            json=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        r.raise_for_status()
        return r.json()


async def _fetch_all_nominations() -> list[dict]:
    data = await _cap_post(_NOMINATIONS_ENDPOINT, {})
    return data.get("value", [])


def _normalize_nomination_number(nomination_number: str) -> str:
    """Normalize nomination number — strip leading zeros for comparison."""
    stripped = nomination_number.strip().lstrip("0")
    return stripped if stripped else "0"


def _match_nomination(n: dict, normalized: str) -> bool:
    """Match a nomination record against a normalized (stripped) number."""
    raw = n.get("Nominationnumber", "").strip().lstrip("0")
    return raw == normalized


# ── Tool 1: get_nomination ────────────────────────────────────────────────────

class GetNominationInput(BaseModel):
    nomination_number: str = Field(description="Nomination number to retrieve (e.g. 128 or 00000000000000000128)")


async def _get_nomination(nomination_number: str) -> str:
    try:
        normalized = _normalize_nomination_number(nomination_number)
        nominations = await _fetch_all_nominations()

        match = next(
            (n for n in nominations if _match_nomination(n, normalized)),
            None,
        )
        if not match:
            available = [n.get("Nominationnumber", "").strip().lstrip("0") for n in nominations]
            return json.dumps({
                "found": False,
                "nomination_number": nomination_number,
                "message": (
                    f"Nomination '{nomination_number}' not found. "
                    f"Available nominations: {available}"
                ),
            })
        return json.dumps({"found": True, "nomination": match}, indent=2, default=str)
    except Exception as e:
        return f"Error fetching nomination {nomination_number}: {e}"


get_nomination = StructuredTool(
    name="get_nomination",
    description=(
        "Retrieve a nomination record by nomination number. "
        "Returns vessel name, IMO number, material, location, transport system, "
        "origin, destination, scheduled date, and status. "
        "Nomination numbers may be zero-padded (e.g. 4500001234 → 00000000004500001234)."
    ),
    args_schema=GetNominationInput,
    coroutine=_get_nomination,
    handle_tool_error=True,
)


# ── Tool 2: list_nominations ──────────────────────────────────────────────────

async def _list_nominations() -> str:
    try:
        nominations = await _fetch_all_nominations()
        if not nominations:
            return json.dumps({"found": False, "message": "No open nominations found."})
        summary = [
            {
                "nomination_number": n.get("Nominationnumber", "").strip().lstrip("0") or "0",
                "location": n.get("Locationid", ""),
                "material": n.get("Demandmaterial", ""),
                "transport_system": n.get("Transportsystem", ""),
                "scheduled_date": n.get("Scheduleddate", ""),
                "status": n.get("Nomstatus", ""),
                "quantity": f"{n.get('Nominatedqty','')} {n.get('Quantityunit','')}",
            }
            for n in nominations
        ]
        return json.dumps({"found": True, "count": len(summary), "nominations": summary}, indent=2)
    except Exception as e:
        return f"Error listing nominations: {e}"


list_nominations = StructuredTool(
    name="list_nominations",
    description="List all open nominations from the S/4HANA OGS system. Use this when the user asks what nominations are available or to find a nomination number.",
    args_schema=type("EmptyInput", (BaseModel,), {}),
    coroutine=_list_nominations,
    handle_tool_error=True,
)


# ── Tool 3: get_nomination_history ────────────────────────────────────────────

class GetNominationHistoryInput(BaseModel):
    material: str = Field(description="Material / product code (e.g. BLK_GASOLINE 87)")
    location: str = Field(description="Location ID (e.g. USMOB)")
    transport_system: str = Field(description="Transport system code (e.g. BARGE_1743)")
    limit: int = Field(default=30, description="Max historical records to analyse")


async def _get_nomination_history(material: str, location: str, transport_system: str, limit: int = 30) -> str:
    try:
        nominations = await _fetch_all_nominations()

        matching = [
            n for n in nominations
            if n.get("Demandmaterial", "").strip() == material.strip()
            and n.get("Locationid", "").strip() == location.strip()
            and n.get("Transportsystem", "").strip() == transport_system.strip()
        ]

        if not matching:
            return json.dumps({
                "found": False,
                "combination": {"material": material, "location": location, "transport_system": transport_system},
                "message": "No nominations found for this combination — ANOMALY detected. This may be a new lane or a data entry error.",
            })

        records = matching[:limit]
        lead_times = _extract_lead_times(records)
        stats = _compute_stats(lead_times, records)

        return json.dumps({
            "found": True,
            "combination": {"material": material, "location": location, "transport_system": transport_system},
            "statistics": stats,
            "all_records": records,
        }, indent=2, default=str)

    except Exception as e:
        return f"Error fetching nomination history: {e}"


get_nomination_history = StructuredTool(
    name="get_nomination_history",
    description=(
        "Look up historical nominations for a given material + location + transport system combination. "
        "Returns lead time statistics and recent records to support ETA prediction. "
        "If no records found, signals ANOMALY for the agent to alert the supervisor."
    ),
    args_schema=GetNominationHistoryInput,
    coroutine=_get_nomination_history,
    handle_tool_error=True,
)


# ── Tool 4: get_nomination_history_deep ───────────────────────────────────────

class GetNominationHistoryDeepInput(BaseModel):
    material: str = Field(description="Material / product code")
    location: str = Field(description="Location ID")
    transport_system: str = Field(description="Transport system code")
    origin: str = Field(default="", description="Origin port or location (optional)")
    destination: str = Field(default="", description="Destination port or location (optional)")
    supervisor_instruction: str = Field(
        default="",
        description="Free-text instruction from the supervisor to guide reassessment",
    )


async def _get_nomination_history_deep(
    material: str,
    location: str,
    transport_system: str,
    origin: str = "",
    destination: str = "",
    supervisor_instruction: str = "",
) -> str:
    try:
        nominations = await _fetch_all_nominations()

        records = [
            n for n in nominations
            if n.get("Demandmaterial", "").strip() == material.strip()
            and n.get("Locationid", "").strip() == location.strip()
            and n.get("Transportsystem", "").strip() == transport_system.strip()
        ]

        if not records:
            return json.dumps({"found": False, "message": "No historical records found even with deep search."})

        now = datetime.utcnow()
        lead_times_all = _extract_lead_times(records)

        recent_6m = [r for r in records if _months_ago(r.get("Scheduleddate", ""), now) <= 6]
        recent_12m = [r for r in records if _months_ago(r.get("Scheduleddate", ""), now) <= 12]
        older = [r for r in records if _months_ago(r.get("Scheduleddate", ""), now) > 12]

        lt_recent = _extract_lead_times(recent_6m)
        lt_12m = _extract_lead_times(recent_12m)

        monthly: dict[int, list[float]] = defaultdict(list)
        for r in records:
            try:
                month = datetime.fromisoformat(r["Scheduleddate"]).month
                monthly[month].append(float(r.get("Nominatedqty", 0)))
            except Exception:
                pass

        current_month = now.month
        seasonal_lt = monthly.get(current_month, [])

        instruction_note = ""
        effective_lead_times = lead_times_all
        if supervisor_instruction:
            instr = supervisor_instruction.lower()
            if "6 month" in instr or "recent" in instr:
                effective_lead_times = lt_recent or lead_times_all
                instruction_note = "Applied supervisor instruction: using only last 6 months of data."
            elif "rush" in instr or "fastest" in instr:
                effective_lead_times = sorted(lead_times_all)[:max(1, len(lead_times_all) // 4)]
                instruction_note = "Applied supervisor instruction: using fastest quartile of historical shipments."
            elif "conservative" in instr or "worst" in instr:
                effective_lead_times = sorted(lead_times_all)[-(max(1, len(lead_times_all) // 4)):]
                instruction_note = "Applied supervisor instruction: using slowest quartile of historical shipments."

        result = {
            "found": True,
            "total_records": len(records),
            "instruction_applied": instruction_note,
            "recency_breakdown": {
                "last_6_months": {"count": len(recent_6m), "stats": _compute_stats(lt_recent, recent_6m)},
                "last_12_months": {"count": len(recent_12m), "stats": _compute_stats(lt_12m, recent_12m)},
                "older_than_12_months": {"count": len(older)},
            },
            "seasonal_pattern": {
                "current_month": current_month,
                "shipments_in_same_month_historically": len(seasonal_lt),
            },
            "effective_analysis": _compute_stats(effective_lead_times, records),
            "recent_records": records,
        }

        return json.dumps(result, indent=2, default=str)

    except Exception as e:
        return f"Error performing deep nomination history analysis: {e}"


get_nomination_history_deep = StructuredTool(
    name="get_nomination_history_deep",
    description=(
        "Perform a deep historical analysis for ETA reassessment after supervisor rejection. "
        "Considers recency weighting, seasonal patterns, origin/destination, "
        "and applies the supervisor's free-text instruction."
    ),
    args_schema=GetNominationHistoryDeepInput,
    coroutine=_get_nomination_history_deep,
    handle_tool_error=True,
)


# ── Tool 5: record_rejection_reason ──────────────────────────────────────────

class RecordRejectionReasonInput(BaseModel):
    nomination_number: str = Field(description="Nomination number")
    rejected_eta: str = Field(description="The ETA that was rejected (ISO date)")
    rejection_reason: str = Field(description="Supervisor's reason for rejecting the proposed ETA")
    supervisor_instruction: str = Field(default="", description="Optional free-text instruction for reassessment")
    rejected_by: str = Field(description="Supervisor user ID or name")


async def _record_rejection_reason(
    nomination_number: str,
    rejected_eta: str,
    rejection_reason: str,
    supervisor_instruction: str,
    rejected_by: str,
) -> str:
    return json.dumps({
        "success": True,
        "message": f"Rejection reason recorded for nomination {nomination_number}.",
        "rejected_eta": rejected_eta,
        "reason": rejection_reason,
        "supervisor_instruction": supervisor_instruction,
        "rejected_by": rejected_by,
        "note": "Stored in session. Persistent write-back to CAP will be available in a future release.",
    })


record_rejection_reason = StructuredTool(
    name="record_rejection_reason",
    description=(
        "Record the supervisor's rejection reason and optional reassessment instruction. "
        "ALWAYS call this before performing a reassessment."
    ),
    args_schema=RecordRejectionReasonInput,
    coroutine=_record_rejection_reason,
    handle_tool_error=True,
)


# ── Tool 6: get_port_vessel_etas ─────────────────────────────────────────────

class GetPortVesselETAsInput(BaseModel):
    unloco: str = Field(description="Port UN/LOCODE (e.g. USMOB for Mobile Alabama, USHOU for Houston)")


async def _get_port_vessel_etas(unloco: str) -> str:
    try:
        if not MST_API_KEY:
            return json.dumps({"status": "API_KEY_NOT_CONFIGURED", "message": "MST_API_KEY not set."})

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.get(
                f"{MST_BASE_URL}/port/estimate",
                headers={"Authorization": f"Bearer {MST_API_KEY}"},
                params={"unloco": unloco},
            )
            r.raise_for_status()
            data = r.json()

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


get_port_vessel_etas = StructuredTool(
    name="get_port_vessel_etas",
    description=(
        "Get live ETA estimates for ALL vessels currently heading to a specific port, "
        "using real-time AIS data from MyShipTracking. "
        "Use the port UN/LOCODE (e.g. USMOB for Mobile Alabama). "
        "This is the PRIMARY intelligence source — use it first to check if a nomination's vessel "
        "already has a live ETA tracked at the destination port."
    ),
    args_schema=GetPortVesselETAsInput,
    coroutine=_get_port_vessel_etas,
    handle_tool_error=True,
)


# ── Tool 7: myshiptracking_lookup ─────────────────────────────────────────────

class MyShipTrackingInput(BaseModel):
    vessel_name: str = Field(description="Vessel name from the nomination")
    imo_number: str = Field(default="", description="IMO number of the vessel (7-digit identifier, optional)")
    destination_unloco: str = Field(default="", description="Destination port UN/LOCODE (e.g. USMOB)")


async def _myshiptracking_lookup(vessel_name: str, imo_number: str = "", destination_unloco: str = "") -> str:
    try:
        if not MST_API_KEY:
            return json.dumps({"status": "API_KEY_NOT_CONFIGURED", "message": "MST_API_KEY not set."})

        headers = {"Authorization": f"Bearer {MST_API_KEY}"}

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # Step 1 — search vessel by name
            search_r = await client.get(
                f"{MST_BASE_URL}/vessel/search",
                headers=headers,
                params={"name": vessel_name},
            )
            search_r.raise_for_status()
            vessels = search_r.json().get("data", [])

            if not vessels:
                return json.dumps({"found": False, "vessel_name": vessel_name, "message": f"No vessel found matching '{vessel_name}'."})

            # Match by IMO if provided, else first result
            if imo_number:
                matched = next((v for v in vessels if str(v.get("imo", "")).strip() == str(imo_number).strip()), vessels[0])
            else:
                matched = vessels[0]

            mmsi = matched.get("mmsi")
            if not mmsi:
                return json.dumps({"found": False, "vessel_name": vessel_name, "message": "Vessel found but MMSI not available."})

            # Step 2 — if destination port known, check port estimates for this vessel
            port_eta = None
            if destination_unloco:
                try:
                    port_r = await client.get(
                        f"{MST_BASE_URL}/port/estimate",
                        headers=headers,
                        params={"unloco": destination_unloco},
                    )
                    if port_r.status_code == 200:
                        port_vessels = port_r.json().get("data", [])
                        port_eta = next((v for v in port_vessels if v.get("mmsi") == mmsi), None)
                except Exception:
                    pass

        result = {
            "found": True,
            "source": "myshiptracking.com",
            "vessel_name": matched.get("vessel_name", vessel_name),
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
        else:
            result["note"] = (
                f"Vessel found but no live ETA tracked for port {destination_unloco}. "
                "It may not be heading there currently."
            ) if destination_unloco else "Provide destination_unloco to get live port ETA."

        return json.dumps(result, indent=2)

    except Exception as e:
        return f"Error looking up vessel '{vessel_name}': {e}"


myshiptracking_lookup = StructuredTool(
    name="myshiptracking_lookup",
    description=(
        "Look up a specific vessel by name and get its live ETA at a destination port. "
        "Searches MyShipTracking AIS database by vessel name, matches by IMO if provided, "
        "then checks if vessel has a live ETA tracked at the destination port UN/LOCODE."
    ),
    args_schema=MyShipTrackingInput,
    coroutine=_myshiptracking_lookup,
    handle_tool_error=True,
)


# ── Tool 7: update_nomination_eta ─────────────────────────────────────────────

class UpdateNominationETAInput(BaseModel):
    nomination_number: str = Field(description="Nomination number to update")
    eta: str = Field(description="Approved ETA date (ISO format YYYY-MM-DD)")
    eta_source: str = Field(description="Source: MYSHIPTRACKING, HISTORICAL, or MANUAL")
    confidence: str = Field(default="", description="Confidence level: High, Medium, Low")
    approved_by: str = Field(description="Supervisor user ID or name who approved")


async def _update_nomination_eta(
    nomination_number: str,
    eta: str,
    eta_source: str,
    confidence: str,
    approved_by: str,
) -> str:
    return json.dumps({
        "success": True,
        "nomination_number": nomination_number,
        "eta_updated_to": eta,
        "source": eta_source,
        "confidence": confidence,
        "approved_by": approved_by,
        "message": f"ETA {eta} ({eta_source}) recorded for nomination {nomination_number}. Approved by {approved_by}.",
        "note": "Persistent write-back to S/4HANA will be available once CAP write endpoints are defined.",
    })


update_nomination_eta = StructuredTool(
    name="update_nomination_eta",
    description=(
        "Record an approved ETA for a nomination. "
        "ONLY call this after the supervisor has explicitly approved the ETA."
    ),
    args_schema=UpdateNominationETAInput,
    coroutine=_update_nomination_eta,
    handle_tool_error=True,
)


# ── Tool 8: update_nomination_events ─────────────────────────────────────────

class NominationEvent(BaseModel):
    event_type: str = Field(description="Event type: LOADING, DISCHARGE, BERTHING, DEPARTURE, CUSTOMS, PILOTAGE")
    proposed_date: str = Field(description="Proposed date (ISO format YYYY-MM-DD)")
    reasoning: str = Field(description="Why this date was proposed")
    confidence: str = Field(description="High, Medium, or Low")


class UpdateNominationEventsInput(BaseModel):
    nomination_number: str = Field(description="Nomination number to update")
    events: list[NominationEvent] = Field(description="List of events with proposed dates and reasoning")
    approved_by: str = Field(description="Supervisor user ID or name who approved")


async def _update_nomination_events(
    nomination_number: str,
    events: list[NominationEvent],
    approved_by: str,
) -> str:
    return json.dumps({
        "success": True,
        "nomination_number": nomination_number,
        "events_recorded": [e.model_dump() for e in events],
        "approved_by": approved_by,
        "message": f"{len(events)} event(s) recorded for nomination {nomination_number}. Approved by {approved_by}.",
        "note": "Persistent write-back to S/4HANA will be available once CAP write endpoints are defined.",
    })


update_nomination_events = StructuredTool(
    name="update_nomination_events",
    description=(
        "Record approved nomination event dates. "
        "ONLY call this after the supervisor has explicitly approved all event dates."
    ),
    args_schema=UpdateNominationEventsInput,
    coroutine=_update_nomination_events,
    handle_tool_error=True,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_lead_times(records: list[dict]) -> list[float]:
    lead_times = []
    for r in records:
        scheduled = r.get("Scheduleddate") or r.get("scheduledDate")
        completed = r.get("completedAt")
        if scheduled and completed:
            try:
                sched = datetime.fromisoformat(scheduled)
                comp = datetime.fromisoformat(completed)
                lead_times.append((comp - sched).days)
            except Exception:
                pass
    return lead_times


def _compute_stats(lead_times: list[float], records: list[dict]) -> dict:
    if not lead_times:
        return {"count": len(records), "insufficient_data": True, "note": "Lead time data not available — scheduled dates present but no completion dates yet."}
    avg = statistics.mean(lead_times)
    confidence = (
        "High" if len(lead_times) >= 10 and statistics.stdev(lead_times) < avg * 0.3
        else "Medium" if len(lead_times) >= 5
        else "Low"
    )
    result: dict[str, Any] = {
        "count": len(lead_times),
        "confidence": confidence,
        "lead_time_days": {
            "average": round(avg, 1),
            "minimum": min(lead_times),
            "maximum": max(lead_times),
            "median": round(statistics.median(lead_times), 1),
        },
    }
    if len(lead_times) >= 2:
        result["lead_time_days"]["std_deviation"] = round(statistics.stdev(lead_times), 1)
    return result


def _months_ago(date_str: str, now: datetime) -> float:
    if not date_str:
        return 999
    try:
        dt = datetime.fromisoformat(date_str)
        return (now - dt).days / 30
    except Exception:
        return 999


# ── Tool registry ─────────────────────────────────────────────────────────────

class CreateNominationInput(BaseModel):
    Locationid: str = Field(..., description="Location ID (e.g. USMOB)")
    Demandmaterial: str = Field(..., description="Material number (e.g. BLK_GASOLINE 87)")
    Nominatedqty: str = Field(..., description="Quantity as a string (e.g. '1000')")
    Quantityunit: str = Field(..., description="Unit of measure (e.g. BBL, TNE)")
    Transportsystem: str = Field(..., description="Transport system (e.g. BARGE_1743)")
    Scheduleddate: str = Field(..., description="Scheduled date in YYYY-MM-DD format")


async def _create_nomination(
    Locationid: str,
    Demandmaterial: str,
    Nominatedqty: str,
    Quantityunit: str,
    Transportsystem: str,
    Scheduleddate: str,
) -> str:
    try:
        result = await _cap_post("/createNomination", {
            "Locationid": Locationid,
            "Demandmaterial": Demandmaterial,
            "Nominatedqty": Nominatedqty,
            "Quantityunit": Quantityunit,
            "Transportsystem": Transportsystem,
            "Scheduleddate": Scheduleddate,
        })
        if result.get("success"):
            return (
                f"Nomination created successfully.\n"
                f"Nomination Number: {result.get('Nominationnumber', 'N/A')}\n"
                f"Item Number: {result.get('Itemnumber', 'N/A')}\n"
                f"Message: {result.get('message', '')}"
            )
        else:
            return f"Failed to create nomination: {result.get('message', 'Unknown error')}"
    except Exception as e:
        return f"Error creating nomination: {str(e)}"


create_nomination = StructuredTool.from_function(
    coroutine=_create_nomination,
    name="create_nomination",
    description=(
        "Create a new TSW nomination in S/4HANA OGS. "
        "Requires: location ID, demand material, quantity, unit of measure, "
        "transport system, and scheduled date (YYYY-MM-DD)."
    ),
    args_schema=CreateNominationInput,
)


def get_nomination_eta_tools() -> list[StructuredTool]:
    return [
        list_nominations,
        get_nomination,
        get_port_vessel_etas,
        myshiptracking_lookup,
        get_nomination_history,
        get_nomination_history_deep,
        record_rejection_reason,
        update_nomination_eta,
        update_nomination_events,
        create_nomination,
    ]
