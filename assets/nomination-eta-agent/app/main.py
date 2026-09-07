import os

if os.environ.get("JOULE_RUNTIME"):
    from sap_cloud_sdk.aicore import set_aicore_config
    from sap_cloud_sdk.core.telemetry import auto_instrument
    set_aicore_config()
    auto_instrument()

import asyncio
import logging
from contextlib import asynccontextmanager

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from starlette.middleware.base import BaseHTTPMiddleware
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
        if auth_header.lower().startswith("bearer "):
            pass  # token available if needed
        return await call_next(request)


def _build_app():
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

    # Pre-warm LLM using a background task on first request instead of on_event
    # (Starlette 2.x removed on_event)
    _warmed = False

    async def _warmup_once():
        nonlocal _warmed
        if _warmed:
            return
        _warmed = True
        try:
            logger.info("Pre-warming LLM connection...")
            await _agent_executor.agent._get_llm()
            logger.info("LLM pre-warm complete.")
        except Exception as e:
            logger.warning(f"LLM pre-warm failed (non-fatal): {e}")

    # Patch the app to run warmup on first request
    original_call = _app.__class__.__call__

    async def _warmup_middleware(app_self, scope, receive, send):
        if scope["type"] == "http":
            asyncio.ensure_future(_warmup_once())
        await original_call(app_self, scope, receive, send)

    _app.__class__.__call__ = _warmup_middleware

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
