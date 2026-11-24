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
| `TRADING_LAB_PUBLIC_WORKSPACE` | Set to `true` for the user-requested password-free public workspace; default application behavior remains private |
| `TRADING_LAB_WORKSPACE_PASSWORD` | Required only with password access enabled; shared workspace password, at least 12 characters |
| `TRADING_LAB_SESSION_SECRET` | Independent random signing secret, at least 32 bytes |
| `TRADING_LAB_ORIGIN_TOKEN` | Independent random origin secret, at least 32 bytes; must match Worker `ORIGIN_TOKEN` |
| `TRADING_LAB_ENCRYPTION_KEY` | Fernet key; required to preserve encrypted LLM keys across restarts |

Cloudflare Worker runtime:
- `ORIGIN_URL`: HTTPS Render service origin, with no path, credentials, query or fragment.
- `ORIGIN_TOKEN`: secret matching backend `TRADING_LAB_ORIGIN_TOKEN`; set with Wrangler secret input, never a tracked configuration value.

With `TRADING_LAB_PUBLIC_WORKSPACE=true`, `/api/auth/status` returns `auth_required: false` and the browser enters directly. Anyone with the public link can view and operate the shared workspace. In password mode, the browser authenticates to `/api/auth/login` using a signed HttpOnly/Secure/SameSite=Lax cookie. Direct backend business calls require the internal gateway token in both modes. `/api/health` remains a minimal public health check. This is one shared workspace, not independent user accounts; do not describe it as per-user data isolation.

## Provision and publish order

1. User signs into Cloudflare, Render and Neon; stop if a paid plan or payment requirement appears.
2. Create Neon Free project and inspect its plan; choose a region near Render, obtain the TLS connection string without displaying it in chat/logs.
3. Create the private source repository, upload the reviewed allowlist of source files only, and connect Render to it.
4. Create the Render Free Docker service, set backend environment securely, and verify startup/database initialization/health.
5. Set Worker origin and origin-token secret, deploy directly using Wrangler to the user's Cloudflare account. Do not publish the frontend before the backend is ready.
6. Validate public auth, protected APIs, database persistence, import/create/step/review/report exports and a second independent browser session/device-sized viewport.
7. Record actual deployed URLs, provider resource IDs, source revision, plan checks and acceptance evidence. Preserve source locally regardless of publication failure.

No local SQLite, API key, existing private data or personal files are automatically migrated. Seed synthetic data only. The production model endpoint is unconfigured until the owner chooses one. A model provider may charge separately; deployment itself must not issue paid LLM calls.

## Password-free public access — 2026-11-24

The user requested removal of the public website password. The Docker image and Render blueprint explicitly enable `TRADING_LAB_PUBLIC_WORKSPACE=true`. Existing passwords are ignored in this mode; no password or signing key is placed in frontend assets. The internal origin token and encrypted credential storage remain required. Set the flag to `false` with a valid workspace password to restore password login. This setting applies to the public deployment; local launches keep their existing environment-driven access behavior.

The verification below records the original password-protected deployment.

## Verified deployment — 2026-10-28

- Public platform: https://trading-lab.hy1195571214.workers.dev
- Cloudflare account: `ad2b681fa1b22ac434d9fc4d5e69bc7c`; Worker `trading-lab`; Free tier.
- Backend: https://trading-lab-api-neyw.onrender.com ; Render service `srv-dbgdcbetlv9c73dv8nlg`, Ohio, Free ($0/month).
- Backend deployed source: `eb8f0301e0fd3d626713ac383f7a46cca121f4e1`.
- Database: Neon project `mute-recipe-14995330`, production branch `br-soft-queen-b5jq6b8w`, Ohio, Free plan.
- Source: https://github.com/hy1195571214-byte/trading-lab (private). Render GitHub App is limited to this one repository.

Verified local checks: 48 backend/auth/engine tests; 4 gateway tests; TypeScript/production build; Cloudflare deployment validation. Verified cloud checks: real PostgreSQL schema, encrypted credential roundtrip, persistence, auth protection, Secure/HttpOnly login cookie, logout, safe settings responses, JSON/CSV exports. A public browser created `Public browser verification — DEMO`, advanced three sessions, approved proposals, observed next-open fills, and rejected the final proposal. The browser console reported no errors or warnings. An independent HTTP client verified the same public Cloudflare API.

### Original password-mode signing in

The current public workspace opens without signing in. The following describes password mode only. The owner can view the shared workspace password in Render → `trading-lab-api` → Environment → `TRADING_LAB_WORKSPACE_PASSWORD`. No password is included in this document, source, browser bundle, or deployment log. Share the workspace password only with the intended teammates. This is one shared research workspace; individual user accounts and per-user data isolation are not implemented.

At original deployment verification, the owner was left signed in in the app browser and other devices needed the shared workspace password. Password-free public access now supersedes that requirement. Render Free can take roughly a minute to wake after inactivity. A chosen LLM provider is still unconfigured; current acceptance records use clearly labelled synthetic/demo strategies and do not represent investment results or real-model validation.

For frontend-only/source-documentation changes, `[skip render]` in the Git commit message avoids an unnecessary backend rebuild. Rebuild the frontend before running `scripts/cloudflare.sh deploy`; deploy the updated backend normally for actual backend source changes. Secrets stay in the providers' runtime configuration and must never be committed.
