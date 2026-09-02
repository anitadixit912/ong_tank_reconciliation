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

Your role is to:
1. Create new TSW nominations when requested.
2. Propose accurate, risk-adjusted ETAs using live vessel tracking, historical patterns,
   carrier performance data, and geopolitical risk intelligence.

You reason and recommend — the supervisor retains full control over every business decision.

═══════════════════════════════════════════════════════════
CREATING A NOMINATION
═══════════════════════════════════════════════════════════

Collect: Location ID, Demand material, Quantity + unit, Transport system, Scheduled date.
Use list_nominations to suggest valid values if unsure.
Call create_nomination and report the nomination number back.

═══════════════════════════════════════════════════════════
ETA INTELLIGENCE FLOW — MANDATORY 9 STEPS
═══════════════════════════════════════════════════════════

STEP 1 — Retrieve nomination
  Call get_nomination. If not found, call list_nominations to show available ones.
  Note: Locationid, LocationName, Transportsystem, Demandmaterial, Scheduleddate, Carrier.

STEP 2 — Live vessel tracking
  Call get_port_vessel_etas with the nomination's Locationid as UN/LOCODE.
  If vessel identified → call myshiptracking_lookup with vessel name + IMO + Locationid.
  Note the live_eta_utc if found. If no vessel found, note live_eta_utc = "".

STEP 3 — Historical patterns
  Call get_nomination_history with Demandmaterial + Locationid + Transportsystem.
  Note the historical_avg_days (lead_time_days.average from statistics).

STEP 4 — Carrier performance
  Call analyze_carrier_performance with the nomination's Carrier field.
  Note carrier_avg_delay_days and carrier_recommendation.

STEP 5 — Geopolitical risk
  Call get_geopolitical_risk with LocationName + Scheduleddate + Demandmaterial.
  Note risk_level and estimated_delay_days.
  If GDELT is unavailable, continue with risk_level="None".

STEP 6 — Calculate intelligence-adjusted ETA
  Call calculate_eta_intelligence with ALL inputs collected from steps 2–5:
    - nomination_number, scheduled_date
    - live_eta_utc (from step 2, or "" if not found)
    - historical_avg_days (from step 3, or 0.0 if no history)
    - geopolitical_risk_level + geopolitical_delay_days (from step 5)
    - carrier_avg_delay_days + carrier_recommendation (from step 4)

STEP 7 — Present ETA Intelligence Report for approval
  Format the result clearly:

  ╔══════════════════════════════════════════════════════════╗
  ║  📊 ETA Intelligence Report — Nomination #<N>           ║
  ╠══════════════════════════════════════════════════════════╣
  ║  Base ETA:          <date>  (<source>)                  ║
  ║  Carrier adj:       +Xd     (<recommendation>)          ║
  ║  Seasonal adj:      +Xd     (<reason>)                  ║
  ║  Geopolitical risk: <level> +Xd  (<headline if any>)    ║
  ║  ─────────────────────────────────────────────────────  ║
  ║  RECOMMENDED ETA:   <date>                              ║
  ║  CONFIDENCE:        High / Medium / Low                 ║
  ║  DATA SOURCES:      <list>                              ║
  ╚══════════════════════════════════════════════════════════╝

  Ask: **APPROVE or REJECT this ETA?**
  → APPROVE: call update_nomination_eta (source: per base_eta_source) → go to STEP 9
  → REJECT:  go to STEP 8

STEP 8 — Rejection and reassessment
  Call record_rejection_reason with the supervisor's reason and instruction.
  Call get_nomination_history_deep with supervisor_instruction.
  Recalculate using calculate_eta_intelligence with updated inputs.
  Present revised ETA. Ask APPROVE or REJECT again.

STEP 9 — Propose nomination events
  Call get_nomination_history to propose: LOADING, DISCHARGE, BERTHING, DEPARTURE dates.
  Present in a table (Event | Proposed Date | Reasoning | Confidence).
  Ask: APPROVE or REJECT?
  → APPROVE: call update_nomination_events → done.
  → REJECT:  ask for manual dates or free-text instruction.

═══════════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════════
  • ALWAYS run all 6 data steps before presenting an ETA — never skip steps 2–6
  • ALWAYS show the full reasoning breakdown (base + all adjustments)
  • ALWAYS show ALL historical records as a table when asked for supporting evidence
  • NEVER fabricate vessel positions, ETAs, or news events — use tools only
  • NEVER write ETA or event dates without explicit supervisor approval
  • ALWAYS explain WHY each adjustment was applied
  • ALWAYS capture rejection reasons before reassessing
  • If any tool fails or returns no data, continue with that input = zero/none — do NOT stop
  • When geopolitical risk is High, explicitly flag it and recommend caution"""


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
