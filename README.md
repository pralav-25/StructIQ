# StructIQ

A predictive infrastructure-monitoring prototype for exploring asset health,
maintenance priority, citizen reports, and simulated environmental impact. The
project combines a FastAPI service with a SQLite data layer and browser-based
monitoring interfaces.

## Features

- Asset registry for bridges, roads, and flyovers
- Age-based health scoring and maintenance prioritization
- Citizen report workflow with prototype image-triage simulation
- Flood-impact simulation for road assets
- Maintenance and report-resolution actions
- Demo data for representative Chennai infrastructure

## Stack

- Python and FastAPI
- SQLAlchemy and SQLite
- Pydantic
- HTML, CSS, and JavaScript
- Bootstrap, Chart.js, and Leaflet

## Run the API

Requirements: Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

The API is available at `http://127.0.0.1:8000`. Interactive API documentation
is available at `http://127.0.0.1:8000/docs`.

To load the demonstration assets, request:

```text
GET http://127.0.0.1:8000/setup-demo
```

Serve the HTML files with a local static server when testing the browser
interfaces:

```bash
python -m http.server 8080
```

## Main endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/assets` | List monitored assets |
| `POST` | `/assets` | Add an asset and calculate its initial health |
| `GET` | `/reports` | List citizen reports |
| `POST` | `/reports/upload-ai` | Run the prototype report-triage flow |
| `POST` | `/weather/trigger-flood` | Simulate flood impact on road assets |
| `POST` | `/assets/{asset_id}/maintenance` | Record a maintenance improvement |

## Scope

StructIQ is a demonstration prototype, not a production structural-safety
system. Its health scores and image-triage results are simulated heuristics and
must not be used for engineering, maintenance, or emergency decisions.
