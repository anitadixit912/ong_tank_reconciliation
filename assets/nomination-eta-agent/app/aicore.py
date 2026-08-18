"""Resolve SAP AI Core credentials from a BTP destination and create an LLM."""

from __future__ import annotations
import json, logging, os, time
from typing import Any
import httpx

logger = logging.getLogger(__name__)

try:
    from gen_ai_hub.proxy import set_proxy_version
    from gen_ai_hub.proxy.langchain.init_models import init_llm
    set_proxy_version("gen-ai-hub")
    _GEN_AI_HUB_AVAILABLE = True
except ImportError:
    _GEN_AI_HUB_AVAILABLE = False

AICORE_DESTINATION_ENV = "AICORE_DESTINATION_NAME"
DEFAULT_AICORE_DESTINATION = "aicore"
_TIMEOUT = 20.0
_TTL = 600.0
_cache: dict = {}

def _vcap():
    raw = os.environ.get("VCAP_SERVICES")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}

def _first_binding(label):
    bindings = _vcap().get(label) or []
    if not bindings:
        return None
    return (bindings[0] or {}).get("credentials") or {}

async def _cc_token(url, cid, csec):
    key = f"{url}:{cid}"
    if key in _cache:
        tok, exp = _cache[key]
        if time.monotonic() < exp:
            return tok
    async with httpx.AsyncClient(timeout=_TIMEOUT) as h:
        r = await h.post(url.rstrip("/") + "/oauth/token",
                         data={"grant_type": "client_credentials"},
                         auth=(cid, csec),
                         headers={"Accept": "application/json"})
    r.raise_for_status()
    tok = r.json()["access_token"]
    _cache[key] = (tok, time.monotonic() + _TTL)
    return tok

async def _fetch_dest(name):
    creds = _first_binding("destination") or {}
    if not creds:
        raise RuntimeError("No 'destination' service binding in VCAP_SERVICES.")
    tok = await _cc_token(creds["url"], creds["clientid"], creds["clientsecret"])
    uri = creds["uri"].rstrip("/")
    url = f"{uri}/destination-configuration/v1/destinations/{name}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as h:
        r = await h.get(url, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
    if r.status_code >= 400:
        raise RuntimeError(f"Destination service {r.status_code} for '{name}': {r.text}")
    return r.json()

async def init_llm_from_destination(model_name, *, temperature=0.0, max_tokens=None, destination_name=None):
    """Resolve AI Core BTP destination and return a LangChain LLM."""
    if not _GEN_AI_HUB_AVAILABLE:
        raise RuntimeError("sap-ai-sdk-gen not installed.")
    name = destination_name or os.environ.get(AICORE_DESTINATION_ENV, DEFAULT_AICORE_DESTINATION)
    if not os.environ.get("AICORE_BASE_URL"):
        payload = await _fetch_dest(name)
        cfg = payload.get("destinationConfiguration") or {}
        base_url = (cfg.get("URL") or "").rstrip("/")
        cid = cfg.get("clientId") or ""
        csec = cfg.get("clientSecret") or ""
        tok_url = cfg.get("tokenServiceURL") or ""
        rg = cfg.get("URL.headers.AI-Resource-Group") or cfg.get("AI_RESOURCE_GROUP") or "default"
        if not (base_url and cid and csec and tok_url):
            raise RuntimeError(f"Destination '{name}' missing URL/clientId/clientSecret/tokenServiceURL. Keys: {sorted(cfg.keys())}")
        os.environ["AICORE_BASE_URL"] = base_url
        os.environ["AICORE_AUTH_URL"] = tok_url
        os.environ["AICORE_CLIENT_ID"] = cid
        os.environ["AICORE_CLIENT_SECRET"] = csec
        os.environ["AICORE_RESOURCE_GROUP"] = rg
        logger.info("aicore destination '%s' resolved (base=%s, group=%s)", name, base_url, rg)
    kw: dict[str, Any] = {"temperature": temperature}
    if max_tokens is not None:
        kw["max_tokens"] = max_tokens
    return init_llm(model_name, **kw)
