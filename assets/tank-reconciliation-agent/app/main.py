import os
if os.environ.get("JOULE_RUNTIME"):
    from sap_cloud_sdk.aicore import set_aicore_config
    from sap_cloud_sdk.core.telemetry import auto_instrument
    set_aicore_config()
    auto_instrument()

import logging

import click
import uvicorn
from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentSkill
from starlette.middleware.base import BaseHTTPMiddleware

from agent_executor import AgentExecutor
from mcp_tools import set_user_token
from opentelemetry.instrumentation.starlette import StarletteInstrumentor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5000"))

# "bearer " is 7 characters; strip it to get the raw JWT
_BEARER_PREFIX_LEN = len("bearer ")


class JWTContextMiddleware(BaseHTTPMiddleware):
    """Middleware that extracts JWT token from Authorization header."""

    async def dispatch(self, request, call_next):
        auth_header = request.headers.get("authorization", "")
        token = None
        if auth_header.lower().startswith("bearer "):
            token = auth_header[_BEARER_PREFIX_LEN:]
        set_user_token(token)
        try:
            response = await call_next(request)
            return response
        finally:
            set_user_token(None)


def _build_app():
    _skill = AgentSkill(
        id="tank-reconciliation-agent",
        name="Tank Reconciliation Agent",
        description="An AI agent for hydrocarbon tank stock reconciliation and variance analysis",
        tags=["tank", "reconciliation", "hydrocarbon", "variance"],
        examples=[
            "What is the current variance status for Tank T001?",
            "Show me all URGENT reconciliations pending approval",
            "What was the last ATG reading for Tank T003?",
        ],
    )
    _host = os.environ.get("HOST", "0.0.0.0")
    _port = int(os.environ.get("PORT", "5000"))
    _card = AgentCard(
        name="Tank Reconciliation Agent",
        description="An AI agent for hydrocarbon tank stock reconciliation and variance analysis",
        url=os.environ.get("AGENT_PUBLIC_URL", f"http://{_host}:{_port}/"),
        version="1.0.0",
        default_input_modes=["text", "text/plain"],
        default_output_modes=["text", "text/plain"],
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        skills=[_skill],
    )
    _server = A2AStarletteApplication(
        agent_card=_card,
        http_handler=DefaultRequestHandler(
            agent_executor=AgentExecutor(),
            task_store=InMemoryTaskStore(),
        ),
    )
    _app = _server.build()
    _app.add_middleware(JWTContextMiddleware)
    StarletteInstrumentor().instrument_app(_app)
    return _app


# Gunicorn/uvicorn entrypoint for CF deployment
application = _build_app()


@click.command()
@click.option("--host", default=HOST)
@click.option("--port", default=PORT)
def main(host: str, port: int):
    logger.info(f"Starting A2A server at http://{host}:{port}")
    uvicorn.run(application, host=host, port=port)


if __name__ == "__main__":
    main()