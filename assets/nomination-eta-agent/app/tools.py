"""LangChain tools for the Nomination ETA Proposal Agent (enhanced).

Tools cover:
  - Nomination retrieval from CAP
  - Historical analysis (basic + deep with recency weighting)
  - Rejection reason capture (feedback loop)
  - Marine Traffic live vessel lookup
  - ETA and event write-back (only after supervisor approval)
"""

from __future__ import annotations

import json
import logging
import os
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "").rstrip("/")
MST_API_KEY = os.environ.get("MST_API_KEY", "")
MST_SECRET_KEY = os.environ.get("MST_SECRET_KEY", "")
MST_BASE_URL = "https://api.myshiptracking.com/v1"
_TIMEOUT = 20.0


# ── HTTP helpers ──────────────────────────────────────────────────────────────

async def _cap_get(path: str) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{CAP_BASE_URL}{path}", headers={"Accept": "application/json"})
        r.raise_for_status()
        return r.json()


async def _cap_patch(path: str, payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.patch(
            f"{CAP_BASE_URL}{path}",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        r.raise_for_status()
        return r.json()


async def _cap_post(path: str, payload: dict) -> Any:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            f"{CAP_BASE_URL}{path}",
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        r.raise_for_status()
        return r.json()


# ── Tool 1: get_nomination ────────────────────────────────────────────────────

class GetNominationInput(BaseModel):
    nomination_number: str = Field(description="Nomination number to retrieve")


async def _get_nomination(nomination_number: str) -> str:
    try:
        data = await _cap_get(f"/odata/v4/NominationService/Nominations('{nomination_number}')")
        return json.dumps(data, indent=2)
    except Exception as e:
        return f"Error fetching nomination {nomination_number}: {e}"


get_nomination = StructuredTool(
    name="get_nomination",
    description="Retrieve a nomination record including vessel name, IMO number, material, location, transport system, origin, destination, and scheduled date.",
    args_schema=GetNominationInput,
    coroutine=_get_nomination,
    handle_tool_error=True,
)


# ── Tool 2: get_nomination_history ────────────────────────────────────────────

class GetNominationHistoryInput(BaseModel):
    material: str = Field(description="Material / product code")
    location: str = Field(description="Location ID")
    transport_system: str = Field(description="Transport system code")
    limit: int = Field(default=30, description="Max historical records to retrieve")


async def _get_nomination_history(material: str, location: str, transport_system: str, limit: int = 30) -> str:
    try:
        path = (
            f"/odata/v4/NominationService/NominationHistory"
            f"?$filter=material eq '{material}' and location eq '{location}'"
            f" and transportSystem eq '{transport_system}' and status eq 'COMPLETED'"
            f"&$orderby=completedAt desc&$top={limit}"
        )
        data = await _cap_get(path)
        records = data.get("value", [])

        if not records:
            return json.dumps({
                "found": False,
                "combination": {"material": material, "location": location, "transport_system": transport_system},
                "message": "No historical records found — ANOMALY detected. This may be a new lane or a data entry error.",
            })

        lead_times = _extract_lead_times(records)
        stats = _compute_stats(lead_times, records)

        return json.dumps({
            "found": True,
            "combination": {"material": material, "location": location, "transport_system": transport_system},
            "statistics": stats,
            "recent_records": records[:5],
        }, indent=2, default=str)

    except Exception as e:
        return f"Error fetching nomination history: {e}"


get_nomination_history = StructuredTool(
    name="get_nomination_history",
    description=(
        "Look up completed historical nominations for material + location + transport system. "
        "Returns lead time statistics and recent records. "
        "If no records found, signals ANOMALY for the agent to alert the supervisor."
    ),
    args_schema=GetNominationHistoryInput,
    coroutine=_get_nomination_history,
    handle_tool_error=True,
)


# ── Tool 3: get_nomination_history_deep ───────────────────────────────────────

class GetNominationHistoryDeepInput(BaseModel):
    material: str = Field(description="Material / product code")
    location: str = Field(description="Location ID")
    transport_system: str = Field(description="Transport system code")
    origin: str = Field(default="", description="Origin port or location (optional)")
    destination: str = Field(default="", description="Destination port or location (optional)")
    supervisor_instruction: str = Field(
        default="",
        description="Free-text instruction from the supervisor to guide reassessment, e.g. 'ignore shipments older than 6 months' or 'this is a rush order'",
    )


async def _get_nomination_history_deep(
    material: str,
    location: str,
    transport_system: str,
    origin: str = "",
    destination: str = "",
    supervisor_instruction: str = "",
) -> str:
    """Deep historical analysis with recency weighting, seasonality, and deviation detection."""
    try:
        # Build filter — broaden if origin/destination provided
        base_filter = (
            f"material eq '{material}' and location eq '{location}'"
            f" and transportSystem eq '{transport_system}' and status eq 'COMPLETED'"
        )
        if origin:
            base_filter += f" and origin eq '{origin}'"
        if destination:
            base_filter += f" and destination eq '{destination}'"

        path = (
            f"/odata/v4/NominationService/NominationHistory"
            f"?$filter={base_filter}&$orderby=completedAt desc&$top=50"
        )
        data = await _cap_get(path)
        records = data.get("value", [])

        if not records:
            return json.dumps({"found": False, "message": "No historical records found even with deep search."})

        now = datetime.utcnow()
        lead_times_all = _extract_lead_times(records)

        # Recency buckets
        recent_6m = [r for r in records if _months_ago(r.get("completedAt", ""), now) <= 6]
        recent_12m = [r for r in records if _months_ago(r.get("completedAt", ""), now) <= 12]
        older = [r for r in records if _months_ago(r.get("completedAt", ""), now) > 12]

        lt_recent = _extract_lead_times(recent_6m)
        lt_12m = _extract_lead_times(recent_12m)

        # Seasonal pattern — group by month
        monthly: dict[int, list[float]] = defaultdict(list)
        for r in records:
            try:
                month = datetime.fromisoformat(r["completedAt"]).month
                sched = datetime.fromisoformat(r["scheduledDate"])
                comp = datetime.fromisoformat(r["completedAt"])
                monthly[month].append((comp - sched).days)
            except Exception:
                pass

        current_month = now.month
        seasonal_lt = monthly.get(current_month, [])

        # Deviation detection — flag outliers (> 1.5x average)
        deviations = []
        if lead_times_all:
            avg = statistics.mean(lead_times_all)
            for r in records[:10]:
                try:
                    sched = datetime.fromisoformat(r["scheduledDate"])
                    comp = datetime.fromisoformat(r["completedAt"])
                    lt = (comp - sched).days
                    if lt > avg * 1.5:
                        deviations.append({
                            "nomination": r.get("Nominationnumber", ""),
                            "completed": r.get("completedAt", ""),
                            "lead_time_days": lt,
                            "vs_average": f"+{round(lt - avg, 1)} days",
                        })
                except Exception:
                    pass

        # Apply supervisor instruction hints
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
                "avg_lead_time_this_month": round(statistics.mean(seasonal_lt), 1) if seasonal_lt else None,
            },
            "recent_deviations": deviations,
            "effective_analysis": _compute_stats(effective_lead_times, records),
            "recent_records": records[:5],
        }

        return json.dumps(result, indent=2, default=str)

    except Exception as e:
        return f"Error performing deep nomination history analysis: {e}"


get_nomination_history_deep = StructuredTool(
    name="get_nomination_history_deep",
    description=(
        "Perform a deep historical analysis for ETA reassessment after supervisor rejection. "
        "Considers recency weighting (last 6/12 months vs older), seasonal patterns, "
        "recent deviations/delays, origin/destination, and applies the supervisor's "
        "free-text instruction to focus the analysis."
    ),
    args_schema=GetNominationHistoryDeepInput,
    coroutine=_get_nomination_history_deep,
    handle_tool_error=True,
)


# ── Tool 4: record_rejection_reason ──────────────────────────────────────────

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
    try:
        payload = {
            "nominationNumber": nomination_number,
            "rejectedEta": rejected_eta,
            "rejectionReason": rejection_reason,
            "supervisorInstruction": supervisor_instruction,
            "rejectedBy": rejected_by,
            "rejectedAt": datetime.utcnow().isoformat() + "Z",
        }
        await _cap_post("/odata/v4/NominationService/ETARejections", payload)
        return json.dumps({
            "success": True,
            "message": f"Rejection reason recorded for nomination {nomination_number}.",
            "rejected_eta": rejected_eta,
            "reason": rejection_reason,
        })
    except Exception as e:
        return f"Error recording rejection reason for nomination {nomination_number}: {e}"


record_rejection_reason = StructuredTool(
    name="record_rejection_reason",
    description=(
        "Record the supervisor's rejection reason and optional reassessment instruction against the nomination. "
        "ALWAYS call this before performing a reassessment — this data feeds the long-term prediction improvement loop."
    ),
    args_schema=RecordRejectionReasonInput,
    coroutine=_record_rejection_reason,
    handle_tool_error=True,
)


# ── Tool 5: myshiptracking_lookup ────────────────────────────────────────────

class MyShipTrackingInput(BaseModel):
    vessel_name: str = Field(description="Vessel name from the nomination")
    imo_number: str = Field(description="IMO number of the vessel (7-digit identifier)")
    destination_port: str = Field(default="", description="Expected destination port (optional)")


async def _myshiptracking_lookup(vessel_name: str, imo_number: str, destination_port: str = "") -> str:
    try:
        if not MST_API_KEY or not MST_SECRET_KEY:
            return json.dumps({
                "source": "myshiptracking.com",
                "vessel_name": vessel_name,
                "imo_number": imo_number,
                "status": "API_KEYS_NOT_CONFIGURED",
                "message": (
                    "MST_API_KEY and MST_SECRET_KEY are not set. "
                    "Get your keys from https://www.myshiptracking.com (Account → API Access). "
                    "Then set via: cf set-env nomination-eta-agent MST_API_KEY <key> && "
                    "cf set-env nomination-eta-agent MST_SECRET_KEY <secret>"
                ),
            })

        headers = {
            "X-API-Key": MST_API_KEY,
            "X-Secret-Key": MST_SECRET_KEY,
            "Accept": "application/json",
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            # Step 1 — search vessel by name to get MMSI
            search_r = await client.get(
                f"{MST_BASE_URL}/vessels/search",
                params={"q": vessel_name},
                headers=headers,
            )
            search_r.raise_for_status()
            search_results = search_r.json()

            vessels = search_results.get("vessels") or search_results if isinstance(search_results, list) else []
            if not vessels:
                return json.dumps({
                    "source": "myshiptracking.com",
                    "vessel_name": vessel_name,
                    "imo_number": imo_number,
                    "found": False,
                    "message": f"No vessel found matching name '{vessel_name}'.",
                })

            # Match by IMO number from search results
            matched = next(
                (v for v in vessels if str(v.get("imo", "")).strip() == str(imo_number).strip()),
                vessels[0],  # fallback to first result if IMO not in search response
            )
            mmsi = matched.get("mmsi", "")

            if not mmsi:
                return json.dumps({
                    "source": "myshiptracking.com",
                    "vessel_name": vessel_name,
                    "imo_number": imo_number,
                    "found": False,
                    "message": "Vessel found by name but MMSI not available — cannot retrieve live status.",
                })

            # Step 2 — get live vessel status + voyage info using MMSI
            status_r = await client.get(
                f"{MST_BASE_URL}/vessels/{mmsi}/status",
                headers=headers,
            )
            status_r.raise_for_status()
            v = status_r.json()

            # Step 3 — get port ETA if destination port provided
            port_eta = None
            if destination_port:
                try:
                    eta_r = await client.get(
                        f"{MST_BASE_URL}/ports/{destination_port}/estimates",
                        params={"mmsi": mmsi},
                        headers=headers,
                    )
                    if eta_r.status_code == 200:
                        port_eta = eta_r.json()
                except Exception:
                    pass

        result = {
            "source": "myshiptracking.com",
            "found": True,
            "vessel_name": v.get("vessel_name", vessel_name),
            "imo_number": imo_number,
            "mmsi": mmsi,
            "current_port": v.get("current_port", ""),
            "destination_port": v.get("destination", destination_port),
            "eta": v.get("eta") or (port_eta.get("eta") if port_eta else None),
            "speed_knots": v.get("speed", ""),
            "course": v.get("course", ""),
            "navigational_status": v.get("navigational_status", ""),
            "last_updated": v.get("timestamp", ""),
        }
        if port_eta:
            result["port_eta_details"] = port_eta

        return json.dumps(result, indent=2)

    except Exception as e:
        return f"Error querying myshiptracking.com for {vessel_name} (IMO {imo_number}): {e}"


myshiptracking_lookup = StructuredTool(
    name="myshiptracking_lookup",
    description=(
        "Look up a vessel's live position, destination, and ETA from myshiptracking.com "
        "using vessel name and IMO number. "
        "Searches by vessel name, matches by IMO, then retrieves live status and voyage ETA."
    ),
    args_schema=MyShipTrackingInput,
    coroutine=_myshiptracking_lookup,
    handle_tool_error=True,
)


# ── Tool 6: update_nomination_eta ─────────────────────────────────────────────

class UpdateNominationETAInput(BaseModel):
    nomination_number: str = Field(description="Nomination number to update")
    eta: str = Field(description="Approved ETA date (ISO format YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)")
    eta_source: str = Field(description="Source: MARINETRAFFIC, HISTORICAL, or MANUAL")
    confidence: str = Field(default="", description="Confidence level: High, Medium, Low (for HISTORICAL source)")
    approved_by: str = Field(description="Supervisor user ID or name who approved")


async def _update_nomination_eta(
    nomination_number: str,
    eta: str,
    eta_source: str,
    confidence: str,
    approved_by: str,
) -> str:
    try:
        payload = {
            "proposedEta": eta,
            "etaSource": eta_source,
            "etaConfidence": confidence,
            "etaApprovedBy": approved_by,
            "etaApprovedAt": datetime.utcnow().isoformat() + "Z",
        }
        await _cap_patch(f"/odata/v4/NominationService/Nominations('{nomination_number}')", payload)
        return json.dumps({
            "success": True,
            "nomination_number": nomination_number,
            "eta_updated_to": eta,
            "source": eta_source,
            "confidence": confidence,
            "approved_by": approved_by,
        })
    except Exception as e:
        return f"Error updating ETA for nomination {nomination_number}: {e}"


update_nomination_eta = StructuredTool(
    name="update_nomination_eta",
    description=(
        "Write an approved ETA back to a nomination. "
        "ONLY call this after the supervisor has explicitly approved the ETA. "
        "Include the confidence level for HISTORICAL source ETAs."
    ),
    args_schema=UpdateNominationETAInput,
    coroutine=_update_nomination_eta,
    handle_tool_error=True,
)


# ── Tool 7: update_nomination_events ─────────────────────────────────────────

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
    try:
        payload = {
            "events": [e.model_dump() for e in events],
            "eventsApprovedBy": approved_by,
            "eventsApprovedAt": datetime.utcnow().isoformat() + "Z",
        }
        await _cap_patch(
            f"/odata/v4/NominationService/Nominations('{nomination_number}')/events",
            payload,
        )
        return json.dumps({
            "success": True,
            "nomination_number": nomination_number,
            "events_updated": len(events),
            "approved_by": approved_by,
        })
    except Exception as e:
        return f"Error updating events for nomination {nomination_number}: {e}"


update_nomination_events = StructuredTool(
    name="update_nomination_events",
    description=(
        "Write approved nomination event dates back to the nomination. "
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
        if r.get("scheduledDate") and r.get("completedAt"):
            try:
                sched = datetime.fromisoformat(r["scheduledDate"])
                comp = datetime.fromisoformat(r["completedAt"])
                lead_times.append((comp - sched).days)
            except Exception:
                pass
    return lead_times


def _compute_stats(lead_times: list[float], records: list[dict]) -> dict:
    if not lead_times:
        return {"count": len(records), "insufficient_data": True}
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

def get_nomination_eta_tools() -> list[StructuredTool]:
    return [
        get_nomination,
        get_nomination_history,
        get_nomination_history_deep,
        record_rejection_reason,
        myshiptracking_lookup,
        update_nomination_eta,
        update_nomination_events,
    ]
