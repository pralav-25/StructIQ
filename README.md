# StructIQ

[![Checks](https://github.com/pralav-25/StructIQ/actions/workflows/ci.yml/badge.svg)](https://github.com/pralav-25/StructIQ/actions/workflows/ci.yml)

An infrastructure maintenance workflow application with private workspaces, an
asset map, community reports, verified photo attachments, and a persistent audit
trail. The Chennai examples and scoring model make it an interactive portfolio
demonstration, not a structural-safety assessment service.

## What works

- Create an account and sign in to a private workspace, or launch an isolated demo.
- Register, edit, search, archive, and restore bridges, roads, and flyovers.
- Explore assets on a map and export the register as CSV.
- Submit an incident with a manually selected priority and optional photo.
- Share a public reporting link without granting dashboard access.
- Track a submitted report through an unguessable status link.
- Record maintenance and resolve incidents with notes; keep the complete history.
- Enable and clear a reversible flood scenario for road assets.
- Use the same application on desktop and mobile.

Demo workspaces last seven days and are cleaned up when a new demo is created.
Registered accounts persist. Authentication uses usernames and passwords; email
recovery is not provided, so keep your password in a password manager. Signing out
of an anonymous demo ends access to that demo in the current browser.

## Run locally

Use Python 3.12 or newer:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload
```

Open **http://127.0.0.1:8000**. The app, API, and static assets are served from the
same origin. No separate frontend server or localhost URL edits are necessary.
Click **Launch private demo** to create a workspace with nine example assets.

The default local database is `.data/structiq.db`, which is ignored by Git. The
legacy `structiq.db` file in the repository is retained as an original example;
the current app does not load or modify it. To use PostgreSQL instead, set
`DATABASE_URL` to a connection string. Both databases use the same application.

## Deploy to Vercel

1. Import this GitHub repository and choose the **FastAPI** framework preset.
2. Connect a persistent PostgreSQL database through Vercel Storage. A Neon Free
   database is sufficient for a small demo. Choose Singapore to match `sin1` in
   `vercel.json`, or change the function region to match your database.
3. Make the database's `DATABASE_URL` available to Production. The native
   integration injects this variable automatically when you connect the project.
4. Deploy `main`, then check `/api/health`. It must return `status: ok` and
   `database: postgresql`.
5. Open the app, create a workspace, submit a report, and reload to verify that
   data persists.

`app.py` exports the ASGI application. `public/static/` is served by Vercel's CDN
and mounted at `/static` by the local server. Database tables are created on
application startup. A deployment without a configured database fails explicitly
instead of pretending that temporary server storage is persistent. Use a separate
database for previews; do not connect untrusted preview code to production data.

No application secret or shared administrator password is required. Session
tokens are random, stored as hashes, and sent in HttpOnly cookies. Production
cookies are Secure. Database credentials belong only in environment variables.

## API and data behavior

The API reference is available at `/docs`. Application endpoints use `/api/`.
Write requests require the `X-Requested-With: StructIQ` header, and private routes
also require a valid session cookie. Cross-origin access is not enabled.

| Route | Purpose |
| --- | --- |
| `POST /api/auth/register`, `/login`, `/demo`, `/logout` | Account and session lifecycle |
| `GET /api/auth/me` | Current workspace |
| `GET, POST /api/assets` | List or register assets |
| `PUT /api/assets/{id}` | Edit an asset |
| `PATCH /api/assets/{id}/archive` | Archive or restore |
| `POST /api/assets/{id}/maintenance` | Record maintenance with a note |
| `GET, POST /api/reports` | Report history and new submissions |
| `POST /api/reports/{id}/resolve` | Retain a report with its resolution |
| `GET /api/reports/{id}/image` | Authenticated access to photo evidence |
| `GET /api/activity` | Latest 100 workspace events |
| `POST /api/scenarios/flood` | Set the flood scenario on or off |
| `GET /api/export` | Spreadsheet-safe CSV export |
| `GET, POST /api/public/{token}/assets or /reports` | Shared reporting flow |
| `GET /api/track/{code}` | Minimal public report status |
| `GET /api/health` | Database connectivity and application version |

Uploads accept actual JPEG, PNG, or WebP images up to 3 MB. Images are decoded,
validated, resized, and re-encoded as JPEG without original metadata. A submitted
photo is retained for human review; the application does **not** diagnose cracks
or infer structural condition from images.

The demo score starts from an age heuristic (3 points/year for roads, 0.5 for other
types); the included examples have explicit illustrative baseline scores. Open
reports subtract 1.5 times the selected severity (5, 10, or 15). The flood scenario
subtracts 15 points from roads while active. Maintenance adds up to 20 baseline
points, capped at 100. Resolution removes that report's penalty exactly once.
Scores are bounded at zero, and priority bands are `<40`, `40–69.9`, and `>=70`.

Every private query is scoped to the authenticated workspace. Anonymous reporting
is limited to the assets exposed by the supplied share token. Tracking links
expose only asset name and timestamps/status, not descriptions, images, or account
details. Limits apply to sign-in, account/demo creation, submissions, and tracking.
Workspaces support 100 assets and 200 reports (50 reports for demos).

## Verification

```sh
ruff check .
python -m unittest discover -s tests -v
node --test tests-web/*.test.mjs
node --check public/static/app.js
```

CI runs the API suite against both SQLite and PostgreSQL 17, plus frontend logic
checks. Tests cover account isolation, invalid uploads, session revocation,
retained/idempotent resolution, public-link scope, reversible scenarios, CSV
formula escaping, and database-backed persistence.

## Scope and dependencies

This project is a working portfolio demo. It has no validated structural model,
live sensors, real weather alerts, municipal integration, or emergency dispatch.
Its scores must not be used for real-world engineering or safety decisions.

Built with FastAPI, SQLAlchemy, PostgreSQL/SQLite, Pillow, and browser JavaScript.
Leaflet 1.9.4 is bundled with its BSD license in `public/static/vendor/`.
Map tiles use OpenStreetMap with visible attribution. Fonts are loaded from Google
Fonts; the interface falls back to system sans-serif if they are unavailable.
