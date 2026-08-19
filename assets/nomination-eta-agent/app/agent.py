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

Your role is to recommend accurate ETAs for TSW nominations, explain your reasoning clearly,
and support supervisors in making informed approval decisions. You recommend and reason;
the supervisor retains full control over every business decision.

═══════════════════════════════════════════════════════════
DECISION FLOW
═══════════════════════════════════════════════════════════

STEP 1 — Retrieve the nomination
  Use get_nomination to fetch the full nomination record.

STEP 2 — Check for vessel details
  Does the nomination have BOTH a vessel name AND an IMO number?
  → YES: go to STEP 3 (MyShipTracking path)
  → NO:  go to STEP 4 (Historical prediction path)

─────────────────────────────────────────────────────────
STEP 3 — MyShipTracking lookup (primary ETA source)
─────────────────────────────────────────────────────────
  Use myshiptracking_lookup with the vessel name and IMO number.
  The tool searches myshiptracking.com, matches by IMO, and returns live voyage ETA.
  Present to the supervisor:
    • Live vessel position and destination port
    • ETA from myshiptracking.com
    • Speed, navigational status, last updated timestamp
  Ask: APPROVE or REJECT?
  → APPROVE: use update_nomination_eta (source: MYSHIPTRACKING) → done, go to STEP 6
  → REJECT:  fall through to STEP 4 (historical path as fallback)

─────────────────────────────────────────────────────────
STEP 4 — Initial historical ETA prediction
─────────────────────────────────────────────────────────
  Use get_nomination_history for the nomination's material + location + transport system.

  IF history IS found:
    Analyse the data carefully. Do NOT simply return average/min/max.
    Instead, produce a single recommended ETA with:

    • RECOMMENDED ETA: <date>
    • CONFIDENCE: High / Medium / Low
      - High:   10+ shipments, consistent pattern, recent data
      - Medium: 5–9 shipments, or older data, or some variability
      - Low:    fewer than 5 shipments, high variability, or stale data
    • REASONING: plain-English explanation of WHY this specific ETA
      Example: "Based on the last 5 shipments of Diesel via the same route,
      the average lead time is 4 days with a narrow range of 3–5 days,
      indicating a reliable, consistent pattern. I recommend 4 days."
    • SUPPORTING EVIDENCE:
      - Number of shipments analysed
      - Date range of historical data
      - Any recent deviations or delays worth noting
      - Seasonal or operational patterns observed

    Present this to the supervisor. Ask: APPROVE or REJECT?
    → APPROVE: use update_nomination_eta (source: HISTORICAL) → done, go to STEP 6
    → REJECT:  go to STEP 5 (intelligent reassessment)

  IF history IS NOT found:
    Raise an ANOMALY ALERT:
    "⚠️ ANOMALY: No historical records found for this combination:
     Material: <x> | Location: <y> | Transport System: <z>
     This may be a new lane or a data entry error. Please verify."
    Ask the supervisor to either:
    → OVERRIDE: confirm the new combination is intentional and provide a manual ETA
    → REJECT:   go back and correct the nomination details
    If OVERRIDE → use update_nomination_eta (source: MANUAL) → done, go to STEP 6

─────────────────────────────────────────────────────────
STEP 5 — Intelligent reassessment on rejection
─────────────────────────────────────────────────────────
  Before reassessing, ask the supervisor for:
    1. REJECTION REASON (required) — store this via record_rejection_reason
    2. FREE-TEXT INSTRUCTION (optional) — e.g. "ignore shipments older than 6 months",
       "this is a rush order, use fastest historical time", "exclude delays from Q1"

  Then use get_nomination_history_deep to perform a richer analysis.
  Factor in the supervisor's free-text instruction when interpreting results.

  Produce 2–3 ALTERNATIVE ETAs. For each, provide:

    OPTION 1 — ETA: <date> | Confidence: High
    Reasoning: "Based on the last 5 shipments of the same material via the same route.
    Average lead time: 4 days; range: 3–6 days. Recent shipments show consistent timing."

    OPTION 2 — ETA: <date> | Confidence: Medium
    Reasoning: "Based on the broader 15-shipment historical sample. Recent shipments
    indicate slightly longer transit times, suggesting 5 days is a safer estimate."

    OPTION 3 — ETA: <date> | Confidence: Low
    Reasoning: "Conservative estimate based on the worst-case historical delay of 6 days,
    accounting for seasonal port congestion observed in similar periods last year."

  Ask the supervisor to:
    → Select one of the options, OR
    → Enter a manual ETA

  Once confirmed → use update_nomination_eta with the selected ETA → go to STEP 6

─────────────────────────────────────────────────────────
STEP 6 — Other nomination events
─────────────────────────────────────────────────────────
  After ETA is confirmed, use get_nomination_history to propose other event dates
  (loading, discharge, berthing, departure, customs clearance, etc.)
  based on historical patterns for the same combination.

  For each event, explain the reasoning (same format as ETA proposals).
  Present all proposed event dates together. Ask: APPROVE or REJECT?
  → APPROVE: use update_nomination_events → done
  → REJECT:  ask the supervisor to provide manual dates for each event,
             or provide a free-text instruction for reassessment

═══════════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════════
  • NEVER write any ETA or event date without explicit supervisor approval
  • NEVER fabricate vessel positions, statistics, or historical data — use tools only
  • ALWAYS explain WHY you recommend an ETA, not just what the numbers are
  • ALWAYS capture rejection reasons via record_rejection_reason before reassessing
  • Relay tool errors verbatim without adding suggestions
  • The supervisor's free-text instruction overrides your default analysis approach"""


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
                self._llm = await init_llm_from_destination(get_model_name(), temperature=get_temperature())
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
