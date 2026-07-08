RUN ME — Migrate Agent to Cloud Foundry (CODE-side runbook, 1 of 2)

You are an autonomous coding agent reading this file as a runbook. This is part 1 of 2: it covers the code, dependency, test, and CF-artefact-generation phases (Phases 1, 2, 2.5, 3, 4, 5). It does not run any `cf` commands. The deploy-side runbook is `migrate-agent-to-cf-deploy.md`.

How to consume this file

1. Execute top-to-bottom. Phases 1 → 5 are sequential; no skipping or reordering.
2. Pause at every `⚠️ ASK USER` marker. Use the available question tool, or emit the prompt as plain chat. Never invent answers.
3. Treat `STOP` literally. Halt, explain what is missing, tell the user what to fix.
4. Log every non-trivial decision as `[CF-MIGRATE] <what> — <why>`.
5. **Templates are inlined at the bottom** between `<!-- TEMPLATE: <name> START -->` / `END -->` markers. Grep, extract the body, substitute placeholders, write the result.
6. No separate `assets/` template files exist — everything is in this file.
7. Operate on the current working directory. Paths are relative unless absolute.
8. At the end of Phase 5, write the audit state to `<agent_dir>/migration-audit/state.json` (full procedure in Step 5.6), summarise the diff, and tell the user to review/commit and then load `migrate-agent-to-cf-deploy.md` to finish deployment. Do not attempt `cf` operations from this file.

Operating principles (CRITICAL)

  You run every shell command. The user has no CLI; any shown shell block is for YOU to execute and parse.
  The user is non-technical. Plain language only.
  User input is limited to: text answers, and a one-time SSO passcode pasted from a browser.

Phase 0 — Agent Selection

Step 0.1 — Detect agent candidates
Scan assets/*/ for directories containing BOTH app/main.py AND app/agent_executor.py.

Step 0.2 — Initialise audit directory
AUDIT_DIR = <agent_dir>/migration-audit
HISTORY_DIR = <agent_dir>/migration-audit/history

Phase 2 — System Detection & User Confirmation

Step 2.1 — Build candidate list from signatures
Step 2.2 — Confirm system list with the user
Step 2.2.a — Inform user about AI Core defaults (aicore destination, gpt-4o model)
Step 2.3 — Decide client module strategy

Phase 2.5 — Acquire API specifications

Step 2.5.1 — Check for pre-existing specs
Step 2.5.2 — Discover and download missing specs
Step 2.5.3 — Fall back to user input when discovery unavailable
Step 2.5.4 — Extract per-system metadata for code generation
Step 2.5.5 — Verification gate

Phase 3 — Stage A: MCP → Direct API Refactor

Step 3.1 — Generate the backend client module(s) [see TEMPLATE: client_module.py below]
Step 3.2 — Refactor app/tools.py
Step 3.3 — Refactor app/agent.py
Step 3.4 — Refactor app/agent_executor.py
Step 3.5 — Decommission or gate MCP artefacts (dual-mode default)
Step 3.6 — Stage A verification

Phase 4 — Stage B: Joule/Kyma → Cloud Foundry

Step 4.1 — Create the AI Core helper [see TEMPLATE: aicore.py below]
Step 4.2 — Update app/agent.py for lazy LLM
Step 4.3 — Update app/main.py
Step 4.4 — Update requirements.txt (dual-mode split)
Step 4.5 — Generate CF deployment artefacts [see TEMPLATES below]
Step 4.6 — Resolve service instances and env vars
  Fixed instance names: proj-vector-destination-service, proj-vector-connectivity-service
Step 4.7 — Joule/Kyma artefacts (keep in dual-mode, gate via .cfignore)

Phase 5 — Test Refactoring

Step 5.1 — Replace MCP fakes with destination-resolver fakes
Step 5.2 — Refactor each domain tool test
Step 5.3 — Add tests/test_<system>_client.py
Step 5.4 — Refactor integration agent flow test
Step 5.5 — Test verification
Step 5.6 — Write final state and audit history

── INLINE TEMPLATES ──

<!-- TEMPLATE: client_module.py START -->

"""SAP backend OData/REST client backed by a BTP destination."""

from __future__ import annotations
import json, logging, os, time
from dataclasses import dataclass, field
from typing import Any
import httpx

logger = logging.getLogger(__name__)

DEFAULT_DESTINATION_NAME = os.environ.get("{{ENV_PREFIX}}_DESTINATION_NAME", "{{DEFAULT_DESTINATION_NAME}}")
DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("{{ENV_PREFIX}}_TIMEOUT_SECONDS", "20.0"))
TOKEN_TTL = float(os.environ.get("DESTINATION_TOKEN_TTL", "600"))
DEST_CACHE_TTL = float(os.environ.get("DESTINATION_CACHE_TTL", "300"))
RESPONSE_ENVELOPE = "{{RESPONSE_ENVELOPE}}"
CSRF_REQUIRED = {{CSRF_REQUIRED}}

def _vcap() -> dict[str, Any]:
    raw = os.environ.get("VCAP_SERVICES")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        logger.warning("VCAP_SERVICES is set but not valid JSON")
        return {}

def _first_binding(label: str) -> dict[str, Any] | None:
    bindings = _vcap().get(label) or []
    if not bindings:
        return None
    return (bindings[0] or {}).get("credentials") or {}

@dataclass
class Destination:
    url: str
    auth_type: str
    username: str | None = None
    password: str | None = None
    sap_client: str | None = None
    proxy_type: str = "Internet"
    additional: dict[str, str] = field(default_factory=dict)

@dataclass
class _CachedToken:
    value: str
    expires_at: float
    def expired(self) -> bool:
        return time.monotonic() >= self.expires_at

class _DestinationResolver:
    def __init__(self, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._timeout = timeout
        self._xsuaa_token: [REDACTED] | None = None
        self._proxy_token: [REDACTED] | None = None
        self._dest_cache: dict[str, tuple[Destination, float]] = {}

    async def _client_credentials_token(self, token_url: str, client_id: str, client_secret: str) -> str:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.post(
                token_url.rstrip("/") + "/oauth/token",
                data={"grant_type": "client_credentials"},
                auth=[REDACTED], client_secret),
                headers={"Accept": "application/json"},
            )
        r.raise_for_status()
        return r.json()["access_token"]

    async def _xsuaa_access_token(self) -> str:
        if self._xsuaa_token and not self._xsuaa_token.expired():
            return self._xsuaa_token.value
        creds = _first_binding("destination") or {}
        if not creds:
            raise RuntimeError("No 'destination' service binding found in VCAP_SERVICES.")
        token = await self._client_credentials_token(creds["url"], creds["clientid"], creds["clientsecret"])
        self._xsuaa_token = [REDACTED], time.monotonic() + TOKEN_TTL)
        return token

    async def _connectivity_proxy_token(self) -> str:
        if self._proxy_token and not self._proxy_token.expired():
            return self._proxy_token.value
        creds = _first_binding("connectivity") or {}
        if not creds:
            raise RuntimeError("Destination is OnPremise but no 'connectivity' service binding was found.")
        token = await self._client_credentials_token(creds["token_service_url"], creds["clientid"], creds["clientsecret"])
        self._proxy_token = [REDACTED], time.monotonic() + TOKEN_TTL)
        return token

    async def resolve(self, name: str) -> Destination:
        cached = self._dest_cache.get(name)
        if cached and time.monotonic() < cached[1]:
            return cached[0]
        creds = _first_binding("destination") or {}
        if not creds:
            raise RuntimeError("No 'destination' service binding found in VCAP_SERVICES.")
        access_token = await self._xsuaa_access_token()
        uri = creds["uri"].rstrip("/")
        url = f"{uri}/destination-configuration/v1/destinations/{name}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"})
        if r.status_code >= 400:
            raise RuntimeError(f"Destination service returned {r.status_code} for '{name}': {r.text}")
        body = r.json()
        cfg = body.get("destinationConfiguration") or {}
        d_url = (cfg.get("URL") or "").rstrip("/")
        if not d_url:
            raise RuntimeError(f"Destination '{name}' has no URL configured.")
        sap_client = cfg.get("sap-client") or cfg.get("SAP-Client") or cfg.get("sap_client")
        well_known = {"URL","Name","Type","Authentication","ProxyType","User","Password","sap-client","SAP-Client","sap_client"}
        additional = {k: v for k, v in cfg.items() if k not in well_known}
        dest = Destination(url=d_url, auth_type=cfg.get("Authentication","NoAuthentication"),
                           username=cfg.get("User"), password=[REDACTED]