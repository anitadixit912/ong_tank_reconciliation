import logging
import os
import time
from dataclasses import dataclass
from typing import AsyncGenerator, Literal, Sequence

from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool
from langgraph.checkpoint.memory import MemorySaver

logger = logging.getLogger(__name__)

try:
    from sap_cloud_sdk.agent_decorators import agent_config, agent_model, prompt_section
except ImportError:
    def _identity_decorator(*_dargs, **_dkwargs):
        def _wrap(fn): return fn
        return _wrap
    agent_model = _identity_decorator
    agent_config = _identity_decorator
    prompt_section = _identity_decorator


@agent_model(key="config.model", label="LLM Model", description="The language model powering this agent")
def get_model_name() -> str:
    return os.environ.get("AGENT_LLM_MODEL", "gpt-4o")


@agent_config(key="config.temperature", label="LLM Temperature", description="Controls randomness (0.0 = deterministic)")
def get_temperature() -> float:
    return 0.0


@prompt_section(key="prompts.system", label="System Prompt", description="Agent role and behavior")
def get_system_prompt() -> str:
    return """You are the TSW Nomination ETA Intelligence Agent for hydrocarbon terminal operations.

Your role is to propose accurate, risk-adjusted ETAs for nominations using live vessel tracking,
historical patterns, carrier performance, and geopolitical risk intelligence.
You also create new nominations when requested.
You recommend — the supervisor approves every final decision.

═══════════════════════════════════════════════════════════
CREATING A NOMINATION
═══════════════════════════════════════════════════════════

Collect: Location ID, Demand material, Quantity + unit, Transport system, Scheduled date.
Use list_nominations to suggest valid values if unsure.
Call create_nomination and report the nomination number back.

═══════════════════════════════════════════════════════════
ETA INTELLIGENCE FLOW — 6 STEPS, RUN WITHOUT STOPPING
═══════════════════════════════════════════════════════════

When asked to propose an ETA, run ALL 6 steps automatically.
NEVER ask permission between steps. If any step returns no data, use zero/none and continue.

STEP 1 — get_nomination
  Extract: Locationid, LocationName, Transportsystem, TransportSystemDesc,
           Demandmaterial, MaterialDesc, Scheduleddate, Carrier, CarrierDesc.
  If not found: call list_nominations and use the matching entry.

STEP 2 — Live vessel tracking
  Call get_port_vessel_etas(Locationid).
  If vessel found → call myshiptracking_lookup(vessel_name, imo, Locationid) → note live_eta_utc.
  If error or not found → live_eta_utc = "". Continue immediately.

STEP 3 — Historical patterns
  Call get_nomination_history(Demandmaterial, Locationid, Transportsystem).
  Note historical_avg_days = statistics.lead_time_days.average (0.0 if not available).

STEP 4 — Carrier performance
  Call analyze_carrier_performance(Carrier).
  Note carrier_avg_delay_days, carrier_recommendation, carrier_name.

STEP 5 — Geopolitical risk
  Call get_geopolitical_risk(LocationName, Scheduleddate, Demandmaterial).
  Note risk_level, estimated_delay_days, first headline title (if any).

STEP 6 — Calculate ETA
  Call calculate_eta_intelligence with:
    nomination_number, scheduled_date,
    live_eta_utc, historical_avg_days,
    geopolitical_risk_level, geopolitical_delay_days, geopolitical_headline,
    carrier_avg_delay_days, carrier_recommendation, carrier_name,
    transport_system (= Transportsystem), material (= Demandmaterial),
    origin_location (origin port name if known), destination_location (= LocationName).

═══════════════════════════════════════════════════════════
STEP 7 — PRESENT THE REPORT (this is what the user sees)
═══════════════════════════════════════════════════════════

Present the report in MARKDOWN format. Fill every field. Never leave a Why blank.

---
## 📊 ETA Intelligence Report — Nomination #<N>
**Material:** <material> | **Transport:** <transport_system_desc> | **Scheduled:** <scheduled_date>

**🗺 Route:** <origin_location if known> → <LocationName>

---
### 📌 Base ETA: `<base_eta_date>` *(source: <base_eta_source>)*
> <base_eta_explanation>

---
### 📋 Adjustments

| Factor | Adjustment | Why |
|--------|-----------|-----|
| 🚢 **Carrier** | <+Xd or No adjustment> | <carrier name + performance summary, OR "No historical data for this carrier — neutral"> |
| 🌦 **Seasonal** | <+Xd or No adjustment> | <seasonal reason with month name, OR "Live AIS used — seasonal buffer not applied"> |
| 🌍 **Geopolitical** | <+Xd or No buffer> | <route + headline if any, OR "GDELT scan near <location> found no disruptions around <date>"> |

---
### ✅ Recommended ETA: `<recommended_eta_date>`
*(Base <base_eta> <+/-X total days>)*

### 📊 Confidence: **<High / Medium / Low>**
> <confidence_note>

### 📡 Data Sources
| Source | Status | Contribution |
|--------|--------|-------------|
| Live Vessel Tracking (MyShipTracking) | <Available / Unavailable — MST_API_KEY not configured> | <vessel ETA or "not available"> |
| Historical Patterns (S/4HANA) | <X records / No completion data> | <avg lead time or "no completions yet"> |
| Carrier Performance | <X records / No data> | <performance summary or "neutral"> |
| Geopolitical Risk (GDELT) | <Available / Unavailable> | <risk level + headline or "no events"> |

---
**Do you APPROVE or REJECT this ETA?**

═══════════════════════════════════════════════════════════
STEPS 8–9
═══════════════════════════════════════════════════════════

STEP 8 — If REJECTED:
  Call record_rejection_reason (supervisor's reason + instruction).
  Call get_nomination_history_deep (pass supervisor_instruction).
  Recalculate with calculate_eta_intelligence using updated inputs.
  Present revised report. Ask APPROVE or REJECT.

STEP 9 — If APPROVED:
  Call update_nomination_eta.
  Call get_nomination_history to propose event dates.
  Show as markdown table:

  | Event | Proposed Date | Why | Confidence |
  |-------|--------------|-----|-----------|
  | Loading | YYYY-MM-DD | <reasoning> | High/Medium/Low |
  | Discharge | YYYY-MM-DD | <reasoning> | High/Medium/Low |
  | Berthing | YYYY-MM-DD | <reasoning> | High/Medium/Low |
  | Departure | YYYY-MM-DD | <reasoning> | High/Medium/Low |

  **Do you APPROVE or REJECT these event dates?**
  → APPROVE: call update_nomination_events → done.
  → REJECT: ask for manual dates.

═══════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════
  • Run all 6 steps automatically — never stop to ask permission
  • Always present the full report before asking for approval
  • Always fill every "Why" field — never leave it empty
  • For DATA SOURCES — always list every source checked, even unavailable ones
  • Never fabricate data — use tools only
  • Never write final ETA without supervisor approval
  • If MST API key missing: note "Live vessel tracking unavailable (MST_API_KEY not configured)"
  • If no carrier history: note "No historical data for this carrier"
  • If GDELT unavailable: note "Geopolitical news scan unavailable" """


@dataclass
class AgentResponse:
    status: Literal["input_required", "completed", "error"]
    message: str


THREAD_TTL_SECONDS = 3600


class NominationETAAgent:
    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

    def __init__(self):
        self._llm = None
        self._checkpointer = MemorySaver()
        self._last_active: dict[str, float] = {}

    def _touch(self, thread_id: str) -> None:
        now = time.monotonic()
        expired = [tid for tid, ts in list(self._last_active.items()) if now - ts > THREAD_TTL_SECONDS]
        for tid in expired:
            del self._last_active[tid]
            logger.info("Evicted inactive thread: %s", tid)
        self._last_active[thread_id] = now

    async def _get_llm(self):
        if self._llm is None:
            try:
                from aicore import init_llm_from_destination
                self._llm = await init_llm_from_destination(get_model_name(), temperature=get_temperature(), max_tokens=4096)
                logger.info("LLM initialised via AI Core destination")
            except Exception as e:
                logger.warning("AI Core destination init failed (%s); falling back to litellm", e)
                try:
                    from langchain_community.chat_models import ChatLiteLLM
                    self._llm = ChatLiteLLM(model=get_model_name(), temperature=get_temperature())
                except ImportError:
                    raise RuntimeError(
                        "Could not initialise LLM: AI Core destination failed and langchain-litellm not installed."
                    ) from e
        return self._llm

    async def stream(
        self,
        query: str,
        context_id: str,
        tools: Sequence[BaseTool] | None = None,
    ) -> AsyncGenerator[dict, None]:
        self._touch(context_id)
        yield {"is_task_complete": False, "require_user_input": False, "content": "Processing..."}

        try:
            llm = await self._get_llm()
            from langgraph.prebuilt import create_react_agent

            system_prompt = get_system_prompt()
            if not tools:
                system_prompt += (
                    "\n\nIMPORTANT: No tools are currently available. "
                    "Do not attempt to call any tools. Respond based on your training knowledge."
                )

            tool_list = list(tools) if tools else []
            logger.info("Running agent with %d tool(s): %s", len(tool_list), [t.name for t in tool_list])

            # LangGraph >=1.0 uses `prompt`; older versions used `state_modifier`
            try:
                graph = create_react_agent(
                    llm,
                    tools=tool_list,
                    checkpointer=self._checkpointer,
                    prompt=system_prompt,
                )
            except TypeError:
                graph = create_react_agent(
                    llm,
                    tools=tool_list,
                    checkpointer=self._checkpointer,
                    state_modifier=system_prompt,
                )
            config = {"configurable": {"thread_id": context_id}}
            result = await graph.ainvoke({"messages": [HumanMessage(content=query)]}, config)
            self._touch(context_id)

            yield {"is_task_complete": True, "require_user_input": False, "content": result["messages"][-1].content}

        except Exception as e:
            logger.exception("Agent stream() failed")
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": (
                    "⚠️ **Unable to process your request**\n\n"
                    "The Nomination ETA Agent encountered an unexpected error. "
                    "Please try again in a moment. If the problem persists, contact your system administrator."
                ),
            }

    async def invoke(
        self,
        query: str,
        context_id: str,
        tools: Sequence[BaseTool] | None = None,
    ) -> AgentResponse:
        last: dict = {}
        async for chunk in self.stream(query, context_id, tools=tools):
            last = chunk
        if last.get("is_task_complete"):
            return AgentResponse(status="completed", message=last["content"])
        if last.get("require_user_input"):
            return AgentResponse(status="input_required", message=last["content"])
        return AgentResponse(status="error", message=last.get("content", "Unknown error"))
