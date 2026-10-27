# Public cloud deployment

Deployment target: Cloudflare Workers static frontend and same-origin API gateway; Render Free single Python web service; Neon Free PostgreSQL. No Sites hosting is used. Public URL is the Cloudflare Worker URL (custom domain optional, not purchased).

## Cost boundaries

Use only Free plans, no payment upgrade, paid disk, paid database, always-on workaround or purchased domain. Render Free may sleep after 15 minutes without inbound traffic and take about a minute to wake. It has an ephemeral filesystem, so persistent records and encrypted provider credentials belong in Neon. Render Free Postgres is not used because it expires after 30 days. Neon Free has usage limits; inspect the account's currently selected plan before provisioning.

Official references checked directly on 2026-10-27:
- https://developers.cloudflare.com/workers/platform/limits/
- https://render.com/docs/free
- https://neon.com/docs/introduction/plans

## Source and build

`Dockerfile` runs the existing Python engine in one Uvicorn worker. Keep one backend instance because the current experiment task locks are per process. `render.yaml` specifies `plan: free` and no paid disk/database. Docker copies only backend application source; local SQLite, private keys, uploaded datasets, logs and acceptance records are excluded.

Frontend: `npm --prefix frontend ci && npm --prefix frontend run build`.
Gateway: `npm --prefix cloudflare ci`, `node --test cloudflare/worker.test.mjs`, then `./scripts/cloudflare.sh deploy --dry-run` before publication. This wrapper keeps Wrangler auth/logs in ignored `work/` paths and disables optional CLI telemetry. Cloudflare config is `cloudflare/wrangler.jsonc`; static assets come from `frontend/dist`.

## Required runtime configuration

Backend environment (never commit values):

| Name | Purpose |
| --- | --- |
| `TRADING_LAB_ENV` | `production` enables required-config checks and Secure cookies |
| `DATABASE_URL` | Neon PostgreSQL connection string; require TLS (`sslmode=require`) |
| `TRADING_LAB_WORKSPACE_PASSWORD` | Shared workspace password, at least 12 characters; each permitted team member uses it |
| `TRADING_LAB_SESSION_SECRET` | Independent random signing secret, at least 32 bytes |
| `TRADING_LAB_ORIGIN_TOKEN` | Independent random origin secret, at least 32 bytes; must match Worker `ORIGIN_TOKEN` |
| `TRADING_LAB_ENCRYPTION_KEY` | Fernet key; required to preserve encrypted LLM keys across restarts |

Cloudflare Worker runtime:
- `ORIGIN_URL`: HTTPS Render service origin, with no path, credentials, query or fragment.
- `ORIGIN_TOKEN`: secret matching backend `TRADING_LAB_ORIGIN_TOKEN`; set with Wrangler secret input, never a tracked configuration value.

Browser authenticates to `/api/auth/login`; backend returns a signed HttpOnly/Secure/SameSite=Lax cookie. Status and logout use `/api/auth/status` and `/api/auth/logout`. All business APIs require the session; direct backend calls also require the internal gateway token. `/api/health` remains a minimal public health check. This is one shared workspace, not independent user accounts; do not describe it as per-user data isolation.

## Provision and publish order

1. User signs into Cloudflare, Render and Neon; stop if a paid plan or payment requirement appears.
2. Create Neon Free project and inspect its plan; choose a region near Render, obtain the TLS connection string without displaying it in chat/logs.
3. Create the private source repository, upload the reviewed allowlist of source files only, and connect Render to it.
4. Create the Render Free Docker service, set backend environment securely, and verify startup/database initialization/health.
5. Set Worker origin and origin-token secret, deploy directly using Wrangler to the user's Cloudflare account. Do not publish the frontend before the backend is ready.
6. Validate public auth, protected APIs, database persistence, import/create/step/review/report exports and a second independent browser session/device-sized viewport.
7. Record actual deployed URLs, provider resource IDs, source revision, plan checks and acceptance evidence. Preserve source locally regardless of publication failure.

No local SQLite, API key, existing private data or personal files are automatically migrated. Seed synthetic data only. The production model endpoint is unconfigured until the owner chooses one. A model provider may charge separately; deployment itself must not issue paid LLM calls.

## Current verification boundary

Local gateway tests and frontend build pass; 48 backend/auth/engine regression tests pass. Neon Free PostgreSQL has been tested with real schema initialization, encrypted key storage, authenticated experiment creation, approval, next-open fills, rejection, persistence, JSON/CSV exports and logout. Cloudflare CLI authorization is complete. Render repository authorization and the actual public deployment are still pending. Do not claim deployment or cross-device access until a live URL responds successfully.
