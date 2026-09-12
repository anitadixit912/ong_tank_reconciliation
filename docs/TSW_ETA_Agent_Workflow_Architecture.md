# TSW ETA Agent — Workflow & Architecture

---

## What It Does
- AI agent that proposes risk-adjusted ETAs for hydrocarbon marine/barge nominations
- Pulls live data from S/4HANA, AIS vessel tracking, and global news
- Supervisor must approve every ETA before it is recorded

---

## Key Components

**SAP S/4HANA TSW (OGS)**
- Source of all nomination data
- OData service: `ZTANK_DIP_SRV_SRV / NominationSet`
- Connected via CAP backend using BTP Destination `OGS_S4`

**CAP Backend (Node.js)**
- Secure proxy between agent and S/4HANA
- Key endpoints: `getOpenNominations`, `createNomination`, `getNominationVesselDetails`

**TSW ETA Agent (Python / LangGraph)**
- Brain of the system — GPT-4o via SAP AI Core
- Runs 6 data-gathering steps automatically before proposing any ETA
- Holds conversation memory per session

**MCP Server (Python)**
- Exposes nomination tools over HTTP/SSE for external clients
- Tools: list, get, create nominations; live vessel ETAs; nomination history

**MyShipTracking (AIS)**
- Live vessel position and ETA data via satellite/radio transponders
- API: `api.myshiptracking.com/api/v2`
- Calls: `/port/estimate` (all vessels heading to a port), `/vessel/search`
- Requires `MST_API_KEY` — if missing, falls back to scheduled date

**GDELT News API (Geopolitical Risk)**
- Free global news database — scans 30 days of headlines near the port
- Detects: strikes, hurricanes, sanctions, closures, accidents
- No API key needed
- Risk levels: None / Low / Medium / High → adds 0–6 day buffer

**LLM (GPT-4o)**
- Hosted on SAP AI Core (BTP)
- Temperature 0.0 — deterministic responses
- Framework: LangGraph ReAct agent

---

## 9-Step Workflow

1. **Fetch Nomination** — pulls all fields from S/4HANA (material, location, transport, carrier, date)
2. **Live Vessel Tracking** — checks AIS for any vessel heading to the destination port
3. **Historical Patterns** — analyses past nominations for same material + location + transport lane
4. **Carrier Performance** — scores carrier on-time record from historical data (RELIABLE → HIGH_RISK)
5. **Geopolitical Risk** — scans GDELT news for disruptions near port around the scheduled date
6. **Calculate ETA** — combines all inputs into a risk-adjusted ETA with confidence score
7. **Present Report** — shows ETA card + reasoning + evidence in chat; asks for approval
8. **If Rejected** — records reason, runs deep historical reassessment, presents 3 alternative ETAs
9. **If Approved** — writes ETA + 4 event dates (Loading, Berthing, Discharge, Departure) to S/4HANA

---

## ETA Base Sources (Priority Order)
- **1st — Live AIS** (most accurate — actual vessel position)
- **2nd — Historical average** (scheduled date + avg lead time from past nominations)
- **3rd — Scheduled date only** (fallback when no other data available)

---

## Confidence Levels
- **High** — Live AIS + historical data + carrier performance all available
- **Medium** — Some data sources available (e.g. historical but no AIS)
- **Low** — Scheduled date only; configure `MST_API_KEY` to improve

---

## Deployment (SAP BTP Cloud Foundry)
- `nomination-eta-agent` — Python + LangGraph
- `nomination-mcp-server` — Python + MCP SDK
- `tank-reconciliation-cap` — Node.js + CDS + React UI
- LLM — GPT-4o via SAP AI Core
- DB — SAP HANA Cloud
