RUN ME — Migrate Agent to Cloud Foundry (DEPLOY-side runbook, 2 of 2)

You are an autonomous coding agent reading this file as a runbook. This is part 2 of 2: it covers CF CLI install, login, push, smoke-test, and post-checks (Phase 6 and Phase 7). It assumes the code-side runbook has been executed.

CF API endpoint (hardcoded): [REDACTED] 6.0 — Preflight

Step 6.0.a — Locate agent and read migration state
  find assets -maxdepth 3 -path 'assets/*/migration-audit/state.json'
  Validate: schema_version==2, agent_dir, selected_systems, aicore_destination_name, llm_model_name, runtime_mode

Step 6.0.b — Verify code-side outputs on disk
  manifest.yml, Procfile, runtime.txt, .cfignore at agent root
  app/aicore.py, client module(s)
  requirements.txt has sap-ai-sdk-gen, gunicorn, uvicorn[standard]; NOT litellm/langchain-litellm/sap-cloud-sdk/click==
  manifest.yml command uses --chdir app main:application (NOT app.main:application)

Step 6.0.c — Quick test rerun
  python -m pytest tests/ -q  (must pass)

Phase 6.0.1 — CF CLI Install

Check cf --version (need v8+). If missing, install:
  python3 -c "import urllib.request; urllib.request.urlretrieve('https://github.com/cloudfoundry/cli/releases/download/v8.9.0/cf8-cli_8.9.0_linux_x86-64.tgz', '/tmp/cf8.tgz')"
  cd /tmp && tar -xzf cf8.tgz
  cp /tmp/cf8 /usr/local/bin/cf && chmod +x /usr/local/bin/cf
  cf --version

Phase 6 — Deployment

Step 6.1 — SSO login
  API endpoint: [REDACTED]  curl -sS [REDACTED]  → read authorization_endpoint → passcode URL
  ASK USER to open <passcode_url> in browser and paste the one-time code
  cf login -a [REDACTED] --sso-passcode <PASSCODE>
  SCRUB passcode from memory immediately after login
  cf orgs → auto-target or ask user
  Fuzzy-match "GDH vector hackathon" naming pattern for auto-selection

Step 6.2 — Verify service offerings
  cf marketplace -e destination
  cf marketplace -e connectivity

Step 6.3 — cf push
  cf push  (from agent root)
  On "Service instance not found": cf create-service <offering> <plan> <name> then retry
  On memory exceeded: reduce manifest.yml memory in 128M steps
  On pip ResolutionImpossible: check for litellm/click conflict

Step 6.4 — No generic env vars (manifest.yml covers everything)

Step 6.5 — Verify agent card
  curl -sS -o /dev/null -w "%{http_code}" https://<route>/.well-known/agent.json  → expect 200

Step 6.6 — End-to-end smoke test
  curl -sS -X POST https://<route>/ -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"smoke","method":"message/send","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"What can you do?"}]}}}'

Phase 7 — Post-Checks + Audit

Step 7.9 — Merge deploy state, write history snapshot, update summary.md
  AUDIT_DIR/state.json gets deployment block added
  HISTORY_DIR/<TS>-deploy.json written
  AUDIT_DIR/summary.md regenerated

Common Pitfalls

  memory limit exceeded → reduce manifest.yml memory: to 384M or 256M
  pip ResolutionImpossible click==8.1.8 → remove litellm from requirements.txt
  ModuleNotFoundError agent_executor at startup → change start command to --chdir app main:application
  PYTHONPATH fix does NOT work → must use --chdir app
  IdentityNotResolvedError → cf set-env <app> AGENT_USER_ID <id> + cf restart
  Destination edit not reflected → cf restart <app> (cache TTL 300s)
  RuntimeError no destination binding → bind proj-vector-destination-service in manifest
  Model not available → cf set-env <app> AGENT_LLM_MODEL <model> + cf restart
