import os

if os.environ.get("JOULE_RUNTIME"):
    from sap_cloud_sdk.aicore import set_aicore_config
    from sap_cloud_sdk.core.telemetry import auto_instrument
    set_aicore_config()
    auto_instrument()

import asyncio
import logging

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from opentelemetry.instrumentation.starlette import StarletteInstrumentor

from agent_executor import AgentExecutor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5000"))

_BEARER_PREFIX_LEN = len("bearer ")


class JWTContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        auth_header = request.headers.get("authorization", "")
        token = None
        if auth_header.lower().startswith("bearer "):
            token = auth_header[_BEARER_PREFIX_LEN:]
        try:
            response = await call_next(request)
            return response
        finally:
            pass


# Global agent executor — pre-warmed on startup
_agent_executor: AgentExecutor | None = None


def _build_app():
    global _agent_executor
    _agent_executor = AgentExecutor()

    _skill = AgentSkill(
        id="nomination-eta-agent",
        name="Nomination ETA Proposal Agent",
        description="Proposes and updates ETAs for TSW nominations using live Marine Traffic data and historical patterns",
        tags=["nomination", "eta", "vessel", "marinetraffic", "hydrocarbon"],
        examples=[
            "Propose an ETA for nomination 4500001234",
            "Look up the vessel ETA for nomination 4500001234",
            "What is the historical lead time for Diesel from location USMOB via pipeline?",
            "Update the events for nomination 4500001234 based on history",
        ],
    )
    _card = AgentCard(
        name="Nomination ETA Proposal Agent",
        description="Proposes and updates ETAs for TSW nominations using live Marine Traffic data and historical patterns",
        url=os.environ.get("AGENT_PUBLIC_URL", f"http://{HOST}:{PORT}/"),
        version="1.0.0",
        default_input_modes=["text", "text/plain"],
        default_output_modes=["text", "text/plain"],
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        skills=[_skill],
    )
    _server = A2AStarletteApplication(
        agent_card=_card,
        http_handler=DefaultRequestHandler(
            agent_executor=_agent_executor,
            task_store=InMemoryTaskStore(),
        ),
    )
    _app = _server.build()
    _app.add_middleware(JWTContextMiddleware)
    StarletteInstrumentor().instrument_app(_app)

    # Pre-warm the LLM on startup so first real request doesn't pay cold start cost
    @_app.on_event("startup")
    async def _warmup():
        try:
            logger.info("Pre-warming LLM connection...")
            await _agent_executor.agent._get_llm()
            logger.info("LLM pre-warm complete.")
        except Exception as e:
            logger.warning(f"LLM pre-warm failed (non-fatal): {e}")

    return _app


application = _build_app()


@click.command()
@click.option("--host", default=HOST)
@click.option("--port", default=PORT)
def main(host: str, port: int):
    logger.info(f"Starting Nomination ETA Agent at http://{host}:{port}")
    uvicorn.run(application, host=host, port=port)


if __name__ == "__main__":
    main()
