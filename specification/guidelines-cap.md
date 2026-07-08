# CAP Guidelines

Technical constraints and patterns for building CAP BTP Extensions. Follow these throughout specification execution.

## Tech Stack

- CAP (Cloud Application Programming Model) — Node.js runtime
- Frontend: React + SAP UI5 Web Components
- Local execution only (no BTP deployment in this stage)

## Project Structure

- CAP project lives in `assets/tank-reconciliation-cap/`
- The `cap-development` skill handles project init, modeling, testing, and frontend scaffolding

## Key Constraints

- You MUST follow the `cap-development` skill for ALL CAP development (modeling, handlers, data, testing, frontend)
- Read the skill before writing any tasks to ensure correct patterns
- Only use public APIs; mock any private systems (like S/4HANA) with minimal mock data
- No Git operations, no authentication, no documentation/READMEs
- No `.env` files (environment variables supplied at runtime)

## asset.yaml

Create `assets/tank-reconciliation-cap/asset.yaml` with:

```yaml
apiVersion: asset.sap/v1
kind: Asset
type: cap-app
metadata:
  name: tank-reconciliation-cap
components:
  - name: srv
    buildPath: .
    outputPath: gen/srv
    provides:
      endpoints:
        - path: /odata/v4
          port: 4004
          protocol: http
      protocols: [odata-v4, rest]
    port: 4004
    requires:
      - name: hdi-container
  - name: hdi-deployer
    type: hdi-deployer
    buildPath: .
    outputPath: gen/db
    requires:
      - hdi-container
    custom:
      lifecycle: init
```

## Testing

- CRITICAL: never skip testing after adding custom handler logic
- Only test custom logic — never test generic CRUD
- Follow testing guidelines in the `cap-development` skill

## Validation

- Run `cds compile srv/` regularly to validate CDS models compile without errors
- Run `cds watch` and curl endpoints to confirm service starts and responds
- All source code must compile, all imports must resolve
- Fix validation failures immediately before proceeding
