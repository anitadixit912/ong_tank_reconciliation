"""MCP tool loader — owned indirection layer between agent code and the Agent Gateway.

In dual-mode (CF + Joule), the real implementation is only loaded when JOULE_RUNTIME=1.
On CF, this module provides stubs so imports don't fail.
"""

import json
import logging
import os
from contextvars import ContextVar, Token
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

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


async def get_mcp_tools(user_token: str | None = None) -> list:
    """Return LangChain-compatible MCP tools.

    In local/test mode (IBD_TESTING=1): returns mock tools from mcp-mock.json.
    On CF without JOULE_RUNTIME: returns empty list (direct API calls used instead).
    On Joule (JOULE_RUNTIME=1): uses Agent Gateway via sap_cloud_sdk.
    """
    if os.environ.get("IBD_TESTING") == "1":
        return _build_mock_tools()

    if not os.environ.get("JOULE_RUNTIME"):
        logger.debug("CF runtime: MCP tools not loaded (use direct API calls)")
        return []

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