"""MCP tool loader — owned indirection layer between agent code and the Agent Gateway.

In dual-mode (CF + Joule), the real implementation is only loaded when JOULE_RUNTIME=1.
On CF, this module provides direct CAP-backed tools for dip reading management.
"""

import json
import logging
import os
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

CAP_BASE_URL = os.environ.get("CAP_BASE_URL", "").rstrip("/")

# Context variable to pass user token from request to tool execution
_user_token_context: ContextVar[str | None] = ContextVar('user_token', default=None)

# mcp-mock.json lives at the asset root (one level above app/)
_MOCK_FILE = Path(__file__).parent.parent / "mcp-mock.json"


def _build_mock_tools() -> list:
    """Build LangChain StructuredTool instances from mcp-mock.json."""
    if not _MOCK_FILE.exists():
        return []
    try:
        mock_data = json.loads(_MOCK_FILE.read_text())
    except Exception:
        logger.warning("Failed to parse mcp-mock.json at %s", _MOCK_FILE, exc_info=True)
        return []

    from langchain_core.tools import StructuredTool
    from pydantic import Field, create_model

    tools = []
    for _server_slug, server in mock_data.get("servers", {}).items():
        for tool_name, tool_def in server.get("tools", {}).items():
            description = tool_def.get("description", "")
            mock_response = tool_def.get("mock_response", {})
            input_schema = tool_def.get("input_schema", {})
            props = input_schema.get("properties", {})
            required_fields = set(input_schema.get("required", []))
            field_definitions: dict = {}
            for field_name, field_info in props.items():
                json_type = field_info.get("type", "string")
                if json_type == "integer":
                    python_type = int
                elif json_type == "number":
                    python_type = float
                elif json_type == "boolean":
                    python_type = bool
                else:
                    python_type = str
                if field_name in required_fields:
                    field_definitions[field_name] = (python_type, Field(description=field_info.get("description", "")))
                else:
                    field_definitions[field_name] = (python_type, Field(default=None, description=field_info.get("description", "")))

            args_schema = (
                create_model(f"{tool_name}_args", **field_definitions)
                if field_definitions
                else create_model(f"{tool_name}_args")
            )
            _response = json.dumps(mock_response)

            async def _coroutine(_resp=_response, **kwargs) -> str:
                return _resp

            tools.append(
                StructuredTool(
                    name=tool_name,
                    description=description,
                    args_schema=args_schema,
                    coroutine=_coroutine,
                    handle_tool_error=True,
                )
            )
    logger.info("Loaded %d mock MCP tool(s) from %s", len(tools), _MOCK_FILE)
    return tools


def _build_cap_dip_tools() -> list:
    """Build direct CAP-backed LangChain tools for dip reading management on CF."""
    if not CAP_BASE_URL:
        logger.warning("CAP_BASE_URL not set — dip tools unavailable")
        return []

    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, Field

    async def _cap_post(path: str, payload: dict) -> dict:
        url = CAP_BASE_URL + path
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers={"Content-Type": "application/json", "Accept": "application/json"})
            resp.raise_for_status()
            return resp.json()

    async def _cap_get(path: str) -> dict:
        url = CAP_BASE_URL + path
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
            resp.raise_for_status()
            return resp.json()

    # ── Tool: get_tank_configurations ─────────────────────────────────────────
    class GetTankConfigurationsInput(BaseModel):
        pass

    async def get_tank_configurations() -> str:
        data = await _cap_get("/reconciliation/TankConfigurations?$orderby=tankId")
        tanks = data.get("value", [])
        if not tanks:
            return "No tank configurations found."
        lines = ["tankId | tankName | plant | toleranceOkPct | toleranceFlagPct"]
        for t in tanks:
            lines.append(f"{t.get('tankId','')} | {t.get('tankName','')} | {t.get('plant','')} | {t.get('toleranceOkPct','')} | {t.get('toleranceFlagPct','')}")
        return "\n".join(lines)

    # ── Tool: list_dip_readings ────────────────────────────────────────────────
    class ListDipReadingsInput(BaseModel):
        tank_id: str = Field(description="20-char SOCNR tank ID, e.g. 00000000000000000023")
        top: int = Field(default=10, description="Maximum number of records to return")

    async def list_dip_readings(tank_id: str, top: int = 10) -> str:
        path = f"/reconciliation/DipReadings?$filter=tankId eq '{tank_id}'&$orderby=createdAt desc&$top={top}"
        data = await _cap_get(path)
        records = data.get("value", [])
        if not records:
            return f"No dip readings found for tank {tank_id}."
        lines = ["date | time | type | value | unit | status | inputMethod"]
        for r in records:
            lines.append(f"{r.get('measurementDate','')} | {r.get('measurementTime','')} | {r.get('dipType','')} | {r.get('dipValue','')} | {r.get('dipUnit','')} | {r.get('postingStatus','')} | {r.get('inputMethod','')}")
        return "\n".join(lines)

    # ── Tool: create_dip_reading ───────────────────────────────────────────────
    class CreateDipReadingInput(BaseModel):
        tank_id: str = Field(description="20-char SOCNR, e.g. 00000000000000000023")
        measurement_date: str = Field(description="Date in YYYY-MM-DD format")
        measurement_time: str = Field(default="", description="Time in HHMMSS format, e.g. 143000")
        dip_type: str = Field(description="I for Innage (depth from bottom), U for Ullage (space from top)")
        dip_value: float = Field(description="Physical measurement value")
        dip_unit: str = Field(description="Unit: MM, CM, L, HL, BBL, or M3")
        water_height: Optional[float] = Field(default=None, description="Free water level (optional)")
        temperature: Optional[float] = Field(default=None, description="Temperature in Celsius for QCI/VCF")
        density: Optional[float] = Field(default=None, description="Density in kg/m³ for QCI/VCF")
        dip_event: str = Field(default="", description="Short event description e.g. Post-discharge")
        notes: str = Field(default="", description="Optional notes")

    async def create_dip_reading(
        tank_id: str, measurement_date: str, dip_type: str,
        dip_value: float, dip_unit: str,
        measurement_time: str = "", water_height: Optional[float] = None,
        temperature: Optional[float] = None, density: Optional[float] = None,
        dip_event: str = "", notes: str = ""
    ) -> str:
        payload = {
            "tankId": tank_id, "measurementDate": measurement_date,
            "measurementTime": measurement_time, "dipType": dip_type.upper(),
            "dipValue": dip_value, "dipUnit": dip_unit.upper(),
            "waterHeight": water_height, "temperature": temperature,
            "density": density, "dipEvent": dip_event,
            "inputMethod": "MANUAL", "notes": notes
        }
        result = await _cap_post("/reconciliation/saveDipReading", payload)
        return f"Dip reading created: ID={result.get('id','?')[:8]}... status={result.get('status','?')}"

    # ── Tool: post_dip_to_sap ─────────────────────────────────────────────────
    class PostDipToSAPInput(BaseModel):
        dip_reading_id: str = Field(description="UUID of the DipReading record to post to SAP IS-Oil")

    async def post_dip_to_sap(dip_reading_id: str) -> str:
        result = await _cap_post("/reconciliation/saveDipToSAP", {"dipReadingId": dip_reading_id})
        success = result.get("success", False)
        message = result.get("message", "")
        return f"{'SUCCESS' if success else 'FAILED'}: {message}"

    # ── Tool: trigger_reconciliation_run ──────────────────────────────────────
    class TriggerRunInput(BaseModel):
        run_date: str = Field(description="Date to run reconciliation for, in YYYY-MM-DD format")
        plant: str = Field(default="", description="SAP plant code, e.g. 1743")

    async def trigger_reconciliation_run(run_date: str, plant: str = "") -> str:
        payload = {"runDate": run_date}
        if plant:
            payload["plant"] = plant
        result = await _cap_post("/reconciliation/triggerRun", payload)
        return f"Run triggered: runId={result.get('runId','?')[:8]}... status={result.get('status','?')}"

    tools = [
        StructuredTool(name="get_tank_configurations", description="List all configured tanks with their SOCNR IDs, names, plants, and variance tolerance thresholds.", args_schema=GetTankConfigurationsInput, coroutine=get_tank_configurations, handle_tool_error=True),
        StructuredTool(name="list_dip_readings",       description="List recent dip readings for a specific tank from the CAP database.", args_schema=ListDipReadingsInput, coroutine=list_dip_readings, handle_tool_error=True),
        StructuredTool(name="create_dip_reading",      description="Create a new dip reading record in CAP. Requires tank SOCNR, date, dip type (I/U), value, and unit.", args_schema=CreateDipReadingInput, coroutine=create_dip_reading, handle_tool_error=True),
        StructuredTool(name="post_dip_to_sap",         description="Post a saved dip reading to SAP IS-Oil via OGS_S4 destination. Call this after create_dip_reading.", args_schema=PostDipToSAPInput, coroutine=post_dip_to_sap, handle_tool_error=True),
        StructuredTool(name="trigger_reconciliation_run", description="Trigger the M1-M6 stock reconciliation pipeline for a given date and plant.", args_schema=TriggerRunInput, coroutine=trigger_reconciliation_run, handle_tool_error=True),
    ]
    logger.info("Built %d CAP dip tools (CAP_BASE_URL=%s)", len(tools), CAP_BASE_URL[:40] if CAP_BASE_URL else "")
    return tools


async def get_mcp_tools(user_token: str | None = None) -> list:
    """Return LangChain-compatible tools.

    In local/test mode (IBD_TESTING=1): returns mock tools from mcp-mock.json.
    On CF without JOULE_RUNTIME: returns direct CAP-backed dip management tools.
    On Joule (JOULE_RUNTIME=1): uses Agent Gateway via sap_cloud_sdk.
    """
    if os.environ.get("IBD_TESTING") == "1":
        return _build_mock_tools()

    if not os.environ.get("JOULE_RUNTIME"):
        return _build_cap_dip_tools()

    # Joule runtime path
    if not user_token:
        raise ValueError("user_token is required for listing and calling MCP tools")

    try:
        from sap_cloud_sdk.agentgateway import create_client
        client = create_client()
        mcp_tools = await client.list_mcp_tools(user_token=user_token)
        if not mcp_tools:
            logger.warning("Agent Gateway returned 0 tools")
            return []
        # Convert to LangChain tools (simplified)
        return mcp_tools
    except Exception:
        logger.exception("Failed to load MCP tools from Agent Gateway")
        return []


def set_user_token(user_token: str | None) -> Token:
    """Set the user token for MCP tool calls in the current async context."""
    return _user_token_context.set(user_token)


def get_user_token() -> str | None:
    """Get the current user token from the async context."""
    return _user_token_context.get()