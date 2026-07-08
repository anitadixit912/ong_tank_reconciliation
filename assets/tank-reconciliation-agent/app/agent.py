import logging
import os
import time
from dataclasses import dataclass
from typing import AsyncGenerator, Literal, Sequence

from langchain_core.messages import HumanMessage, SystemMessage
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


@agent_model(
    key="config.model",
    label="LLM Model",
    description="The language model powering this agent",
)
def get_model_name() -> str:
    return os.environ.get("AGENT_LLM_MODEL", "gpt-4o")


@agent_config(
    key="config.temperature",
    label="LLM Temperature",
    description="Controls randomness of responses (0.0 = deterministic, 1.0 = creative)",
)
def get_temperature() -> float:
    return 0.0


@prompt_section(
    key="prompts.system",
    label="System Prompt",
    description="The full system prompt defining the agent's role and behavior",
)
def get_system_prompt() -> str:
    return """You are an AI agent for hydrocarbon tank stock reconciliation and variance analysis.

You help operations teams by:
- Answering questions about tank variances, ATG readings, and reconciliation run results
- Explaining OK/FLAG/URGENT classification thresholds and their meaning
- Summarising pending approval items for supervisors
- Providing audit trail information for completed reconciliations
- Advising on VCF temperature correction and goods movement postings to S/4HANA

IMPORTANT: You MUST use tools to retrieve live data. Never fabricate, guess, or invent data.
Relay tool errors verbatim without adding suggestions."""


@dataclass
class AgentResponse:
    status: Literal["input_required", "completed", "error"]
    message: str


THREAD_TTL_SECONDS = 3600


class SampleAgent:
    SUPPORTED_CONTENT_TYPES = ["text", "text/plain"]

    def __init__(self):
        self._llm = None
        self._checkpointer = MemorySaver()
        self._last_active: dict[str, float] = {}

    def _touch(self, thread_id: str) -> None:
        now = time.monotonic()
        expired = [
            tid
            for tid, ts in list(self._last_active.items())
            if now - ts > THREAD_TTL_SECONDS
        ]
        for tid in expired:
            del self._last_active[tid]
            logger.info("Evicted inactive thread: %s", tid)
        self._last_active[thread_id] = now

    async def _get_llm(self):
        if self._llm is None:
            try:
                from aicore import init_llm_from_destination
                self._llm = await init_llm_from_destination(
                    get_model_name(), temperature=get_temperature()
                )
                logger.info("LLM initialised via AI Core destination")
            except Exception as e:
                logger.warning(
                    "AI Core destination init failed (%s); falling back to litellm", e
                )
                try:
                    from langchain_community.chat_models import ChatLiteLLM
                    self._llm = ChatLiteLLM(
                        model=get_model_name(), temperature=get_temperature()
                    )
                except ImportError:
                    raise RuntimeError(
                        "Could not initialise LLM: AI Core destination failed "
                        "and langchain-litellm not installed."
                    ) from e
        return self._llm

    async def stream(
        self,
        query: str,
        context_id: str,
        tools: Sequence[BaseTool] | None = None,
    ) -> AsyncGenerator[dict, None]:
        self._touch(context_id)
        yield {
            "is_task_complete": False,
            "require_user_input": False,
            "content": "Processing...",
        }

        try:
            llm = await self._get_llm()

            # Use langgraph's create_react_agent — standard across langchain 1.2.x / 1.3.x
            from langgraph.prebuilt import create_react_agent

            system_prompt = get_system_prompt()
            if not tools:
                system_prompt += (
                    "\n\nIMPORTANT: No tools are currently available. "
                    "Do not attempt to call any tools. Respond based on your training knowledge."
                )

            tool_list = list(tools) if tools else []
            tool_names = [t.name for t in tool_list]
            logger.info("Running agent with %d tool(s): %s", len(tool_names), tool_names)

            graph = create_react_agent(
                llm,
                tools=tool_list,
                checkpointer=self._checkpointer,
                state_modifier=system_prompt,
            )
            config = {"configurable": {"thread_id": context_id}}
            result = await graph.ainvoke(
                {"messages": [HumanMessage(content=query)]}, config
            )
            self._touch(context_id)
            response = result["messages"][-1].content

            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": response,
            }

        except Exception as e:
            logger.exception("Agent stream() failed")
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": (
                    f"I encountered an error while processing your request: {e}. "
                    "Please try again."
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
        return AgentResponse(
            status="error", message=last.get("content", "Unknown error")
        )
