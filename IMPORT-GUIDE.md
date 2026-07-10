# Tank Reconciliation Solution — Import & Setup Guide

## What's Inside the ZIP

```
assets/
├── tank-reconciliation-cap/      ← CAP Node.js backend + React UI
├── tank-reconciliation-agent/    ← Python AI Agent
└── n8n/workflows/                ← n8n Workflow JSON
```

---

## Step 1 — Extract the ZIP

Unzip the file to any folder on your machine:

```
tank-reconciliation-solution.zip  →  unzip to a local folder
```

---

## Step 2 — Deploy the CAP Application

### Prerequisites
- Node.js 18+
- Cloud Foundry CLI (`cf` or `cf8`) logged in to your BTP space
- A BTP Destination named `S4HANA_PUBLIC_CLOUD` pointing to your S/4HANA system

### Build & Push

```bash
cd assets/tank-reconciliation-cap

# 1. Install dependencies
npm install

# 2. Build React UI
cd app/react-ui && npm install && npm run build
cd ../..

# 3. Run the CAP build (copies UI into gen/srv)
node build.js

# 4. Push to Cloud Foundry
cf push tank-reconciliation-cap-srv -f manifest.yml
```

The app will be available at the URL shown after the push completes.

---

## Step 3 — Deploy the AI Agent

### Prerequisites
- Python 3.11+
- Cloud Foundry CLI logged in

```bash
cd assets/tank-reconciliation-agent

# Push to Cloud Foundry
cf push tank-reconciliation-agent
```

---

## Step 4 — Import the n8n Workflow

1. Open your **n8n** instance (self-hosted or cloud)
2. Click **"Import from file"**
3. Select the file:  
   `assets/n8n/workflows/tank-reconciliation-agent.n8n.json`
4. Update any credentials or webhook URLs inside the workflow to match your environment
5. Activate the workflow

---

## Step 5 — Configure S/4HANA Connection

1. In SAP BTP Cockpit, go to **Connectivity → Destinations**
2. Make sure a destination named **`S4HANA_PUBLIC_CLOUD`** exists with:
   - URL: `https://<your-s4hana-hostname>`
   - Authentication: `BasicAuthentication`
   - User / Password: your Communication User credentials
3. Bind this destination service to `tank-reconciliation-cap-srv` (already declared in `manifest.yml`)

---

## Verify Everything Works

| Check | How |
|---|---|
| App is running | Visit the app URL — Dashboard should load |
| View run details | Click "View" on any reconciliation run — no 400 error |
| S/4HANA data | Trigger a new run — check audit log for `vcfSource=S4HANA_LIVE` |
| AI Agent | Hit the agent URL — should return a 200 response |

---

## Environment Variables (already in manifest.yml)

| Variable | Purpose |
|---|---|
| `S4HANA_DEST` | Name of the BTP Destination for S/4HANA |
| `NODE_ENV` | Set to `production` |
| `approuter_forward_auth_token` | `true` (token forwarding) |

---

## Need Help?

Refer to `assets/tank-reconciliation-cap/readme.md` for full technical details.
