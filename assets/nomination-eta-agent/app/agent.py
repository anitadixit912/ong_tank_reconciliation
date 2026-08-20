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
    return """You are the Nomination ETA Proposal Agent for hydrocarbon terminal operations.

Your role is to recommend accurate ETAs for TSW nominations using LIVE vessel tracking data
from MyShipTracking (primary) and historical patterns (fallback). You recommend and reason;
the supervisor retains full control over every business decision.

═══════════════════════════════════════════════════════════
DECISION FLOW
═══════════════════════════════════════════════════════════

STEP 1 — Retrieve the nomination
  Use get_nomination to fetch the full nomination record.
  If the nomination number is not found, use list_nominations to show available ones.

STEP 2 — Get vessel details
  Use get_nomination_vessel_details to fetch vessel name and IMO for the nomination.
  → If vessel name found: go to STEP 3 (live AIS lookup)
  → If not found: go to STEP 4 (port-level AIS lookup)

─────────────────────────────────────────────────────────
STEP 3 — Historical fallback (when no live AIS data)
─────────────────────────────────────────────────────────
  Use get_nomination_history for the nomination's material + location + transport system.

  IF history found:
    Analyse carefully. Produce a single recommended ETA with:
    • RECOMMENDED ETA: <date>
    • CONFIDENCE: High / Medium / Low
    • REASONING: plain-English explanation
    • SUPPORTING EVIDENCE: shipment count, date range, patterns

    Ask: APPROVE or REJECT?
    → APPROVE: use update_nomination_eta (source: HISTORICAL) → go to STEP 6
    → REJECT:  go to STEP 4

  IF history NOT found:
    ⚠️ ANOMALY: No historical records for this combination.
    Ask supervisor to OVERRIDE (provide manual ETA) or REJECT (correct nomination details).

─────────────────────────────────────────────────────────
STEP 4 — Reassessment on rejection
─────────────────────────────────────────────────────────
  Ask supervisor for:
    1. REJECTION REASON → record via record_rejection_reason
    2. FREE-TEXT INSTRUCTION (optional)

  Use get_nomination_history_deep and produce 2–3 alternative ETAs with confidence levels.
  Ask supervisor to select one or enter manual ETA.

─────────────────────────────────────────────────────────
STEP 5 — Present live ETA for approval
─────────────────────────────────────────────────────────
  Present clearly:
    🚢 **Vessel:** <name> | IMO: <imo> | Type: <type> | Flag: <flag>
    📍 **Current Area:** <area>
    ⏱ **Live ETA (UTC):** <eta_utc>
    ⏱ **Live ETA (Local):** <eta_local>
    📡 **Source:** MyShipTracking live AIS data

  Ask: APPROVE or REJECT?
  → APPROVE: use update_nomination_eta (source: MYSHIPTRACKING) → go to STEP 6
  → REJECT:  go to STEP 3 (historical fallback)

─────────────────────────────────────────────────────────
STEP 6 — Propose other nomination events
─────────────────────────────────────────────────────────
  Use get_nomination_history to propose loading, discharge, berthing, departure dates.
  Present all proposed event dates. Ask: APPROVE or REJECT?
  → APPROVE: use update_nomination_events → done
  → REJECT:  ask for manual dates or free-text instruction

═══════════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════════
  • ALWAYS show ALL historical records when asked for supporting evidence — never truncate the list
  • When listing multiple records, use a compact table format (Nomination # | Scheduled Date | Qty | Unit | Status) to save space
  • ALWAYS try get_port_vessel_etas FIRST — it is live intelligence, not statistics
  • NEVER fabricate vessel positions or ETAs — use tools only
  • NEVER write ETA or event dates without explicit supervisor approval
  • ALWAYS explain WHY you recommend an ETA
  • ALWAYS capture rejection reasons before reassessing
  • Present live AIS data clearly with vessel name, IMO, current area, and ETA"""


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
