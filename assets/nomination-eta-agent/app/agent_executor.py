import logging
import os

from a2a.server.agent_execution import AgentExecutor as A2AAgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import (
    InternalError,
    Part,
    TaskState,
    TextPart,
    UnsupportedOperationError,
)
from a2a.utils import new_agent_text_message, new_task
from a2a.utils.errors import ServerError

from agent import NominationETAAgent
from tools import get_nomination_eta_tools

logger = logging.getLogger(__name__)

MCP_SERVER_URL = os.environ.get("NOMINATION_MCP_SERVER_URL", "")


class AgentExecutor(A2AAgentExecutor):
    def __init__(self):
        self.agent = NominationETAAgent()
        self.nomination_tools = get_nomination_eta_tools()

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        query = context.get_user_input()
        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        updater = TaskUpdater(event_queue, task.id, task.context_id)

        try:
            await self._run(query, task, updater)
        except Exception as e:
            logger.exception("Nomination ETA agent execution error")
            raise ServerError(error=InternalError()) from e

    async def _run(self, query, task, updater):
        # Try MCP — keep session open for entire agent execution
        if MCP_SERVER_URL:
            try:
                from mcp import ClientSession
                from mcp.client.sse import sse_client
                from langchain_mcp_adapters.tools import load_mcp_tools

                async with sse_client(f"{MCP_SERVER_URL}/sse") as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        tools = await load_mcp_tools(session)
                        logger.info("Using %d MCP tool(s) from %s", len(tools), MCP_SERVER_URL)
                        await self._stream(query, task, updater, tools)
                        return
            except Exception as e:
                logger.warning("MCP unavailable (%s) — falling back to direct tools", e)

        # Fallback: direct tools
        tools = list(self.nomination_tools)
        logger.info("Using %d direct tool(s)", len(tools))
        await self._stream(query, task, updater, tools)

    async def _stream(self, query, task, updater, tools):
        async for item in self.agent.stream(query, task.context_id, tools=tools):
            is_task_complete = item["is_task_complete"]
            require_user_input = item["require_user_input"]
            content = item["content"]

            if require_user_input:
                await updater.update_status(
                    TaskState.input_required,
                    new_agent_text_message(content, task.context_id, task.id),
                    final=True,
                )
                break
            elif is_task_complete:
                await updater.add_artifact(
                    [Part(root=TextPart(text=content))], name="agent_result"
                )
                await updater.complete()
                break
            else:
                await updater.update_status(
                    TaskState.working,
                    new_agent_text_message(content, task.context_id, task.id),
                )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise ServerError(error=UnsupportedOperationError())


