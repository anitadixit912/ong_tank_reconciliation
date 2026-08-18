---
name: nomination-eta
description: Propose, reassess, and write ETAs for TSW nominations using Marine Traffic live data, deep historical analysis, and Human-in-the-Loop approval
---

# Nomination ETA Proposal — Skill

## Decision Flow

```
Nomination created
       │
       ├── Vessel name + IMO present?
       │         YES → Marine Traffic lookup → Approve/Reject
       │         NO  → Historical prediction → Approve/Reject
       │                      │
       │               Reject → record reason + instruction
       │                      → Deep reassessment
       │                      → 2-3 alternatives with confidence + reasoning
       │                      → Supervisor selects or enters manual ETA
       │
       └── ETA confirmed → Propose other events → Approve/Reject
```

## Tools

| Tool | When to use |
|------|-------------|
| `get_nomination` | First step — fetch nomination details |
| `get_nomination_history` | Initial ETA prediction — basic lead time stats |
| `get_nomination_history_deep` | After rejection — deep analysis with recency, seasonality, deviations, supervisor instruction |
| `record_rejection_reason` | Before every reassessment — captures feedback for prediction improvement |
| `marinetraffic_lookup` | When vessel name + IMO number present |
| `update_nomination_eta` | Only after explicit supervisor approval |
| `update_nomination_events` | Only after explicit supervisor approval of event dates |

## Confidence Levels

| Level | Criteria |
|-------|----------|
| High | 10+ shipments, low variance, recent data |
| Medium | 5–9 shipments, or older data, or moderate variability |
| Low | Fewer than 5 shipments, high variability, or stale data |

## Anomaly Detection

If `get_nomination_history` returns `found: false`:
- Alert the supervisor with the exact combination (material + location + transport system)
- Ask them to OVERRIDE (confirm + manual ETA) or REJECT (correct nomination)
- Never proceed silently on an unknown combination
