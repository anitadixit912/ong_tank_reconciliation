# How to Get the Source Code

The full source code is already inside the `assets/` folder in this solution.
The file browser shows all the source files — you can view and copy them from there.

## Key folders

| Folder | What's inside |
|---|---|
| `assets/tank-reconciliation-cap/` | CAP backend + React UI source |
| `assets/tank-reconciliation-cap/app/react-ui/src/` | All React pages and components |
| `assets/tank-reconciliation-cap/srv/` | CAP service logic + S/4HANA integration |
| `assets/tank-reconciliation-cap/db/` | Data model + seed data |
| `assets/tank-reconciliation-agent/app/` | AI Agent Python code |
| `assets/n8n/workflows/` | n8n workflow JSON |

## To deploy from scratch on another machine

1. Clone/copy the `assets/` folder to your machine
2. Follow the steps in `IMPORT-GUIDE.md` at the project root
3. Run `node build.js` inside `assets/tank-reconciliation-cap/` to rebuild
4. Run `cf push` to deploy to BTP

## Your app is already live!

The application is deployed and running at:
`[REDACTED]`

No download needed to use it — just open that URL.
