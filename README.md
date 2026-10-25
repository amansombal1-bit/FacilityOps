# FacilityOps

React + Vite frontend, Express REST API, Prisma/PostgreSQL, Google Workspace OAuth adapters, and a durable PostgreSQL outbox/worker. The Express service serves the built frontend on the same origin. No browser timer is responsible for sending reminders.

**Delivery status: implemented and locally tested; not deployed.** No live Gmail, Drive, AI provider, Cloud SQL, Cloud Scheduler, custom domain or Cloud Run connection has been asserted. See `docs/VERIFICATION.md` for precise test evidence and remaining acceptance gates.

## Start here

- `docs/SETUP.md`: local run, database setup, first administrator, Workspace consent.
- `docs/DEPLOYMENT.md`: Cloud Run / Cloud SQL / Scheduler / Secret Manager setup.
- `docs/SECURITY.md`: security model, limitations, retention and recovery runbook.
- `docs/STARTER_REVIEW.md`: supplied starter findings and replacement decisions.
- `docs/API.md`: endpoints and permission rules.
- `docs/VERIFICATION.md`: genuinely verified features versus external integration status.

## Project structure

```text
client/
  index.html
  src/main.jsx           login, dashboards, task/evidence/review, team, reports, settings
  src/style.css          responsive accessible styling; no external font/CDN dependency
server/
  app.js                 middleware, same-origin CSRF, API routing, static delivery
  index.js               server lifecycle and shutdown
  config.js              validated server environment; fail-closed production settings
  auth.js                allowlist, OTP, durable rate limits, revocable sessions
  tasks.js               task/evidence/approval APIs and transactional invariants
  admin.js               users, settings, reports, optional AI draft endpoint
  domain.js              deterministic policy and timezone functions
  notifications.js       transactional workflow notification enqueueing
  worker.js              scheduler sweep, job claiming, retries, delivery attempts
  integrations.js        OAuth Gmail and private Drive adapters; explicit local test mode
  crypto.js              keyed OTP digests, random session tokens, encrypted OTP jobs
  db.js                  Prisma connection and serializable transaction retry
  bootstrap.js           operator-only first FM provisioning
  google-setup.js        localhost OAuth setup with state and sender verification
prisma/
  schema.prisma
  migrations/            initial schema + append-only audit guard
  migrations/migration_lock.toml
tests/
  domain.test.js         cadence, quiet hours, permissions, evidence rules, CSV safety
  integration.test.js    actual Express/Prisma API + embedded Postgres tests
  browser.mjs            browser OTP/login/task creation/mobile smoke test
.github/workflows/ci.yml PostgreSQL 16, production build, audit, browser CI checks
Dockerfile               non-root multi-stage production image
compose.yaml             local PostgreSQL 16 only
.env.example             names and placeholders; no production secrets
vite.config.js
vitest.config.js
deploy/
  infra.tf               Cloud SQL HA/PITR, repository, identities, secret containers
  cloudbuild.yaml         immutable container build
  deploy.sh              migration job, application, minute-scheduled worker
```

## Local commands

Requires Node 24 and Docker/PostgreSQL. Run from this directory:

```bash
npm ci
cp .env.example .env
# Edit .env using docs/SETUP.md; do not commit it.
# Set LOCAL_DB_PASSWORD in your shell before starting the local database.
docker compose up -d postgres
npm run db:generate
node --env-file=.env node_modules/prisma/build/index.js migrate deploy
node --env-file=.env server/bootstrap.js
npm run dev:api
# In a second terminal:
npm run dev
# In a third terminal, invoke periodically (production uses Cloud Scheduler):
node --env-file=.env server/worker.js
```

Development browser origin: `http://localhost:5173`. API: `http://localhost:8080`; Vite proxies `/api`. To serve the production bundle locally, set APP_ORIGIN to `http://localhost:8080`, build, and run `node --env-file=.env server/index.js` with NODE_ENV=development.

```bash
npm test
npm run build
npm audit --omit=dev
npx playwright install chromium
node tests/browser.mjs
```

Tests default to ephemeral PGlite (PostgreSQL engine over TCP), not SQLite or a mocked Prisma client. Set TEST_DATABASE_URL to a disposable database named `facilityops_test` for PostgreSQL 16 testing. The provided CI uses that route. Never point test configuration at production.

## Workflow

FM creates/assigns → owner captures a before photo when required → owner starts work → owner captures completion evidence and enters corrective action → Awaiting FM Approval → FM approves to complete, or rejects to a new rework cycle. Old evidence and rejection history remain available. Cancellation requires FM and a reason; it is separately reported and never labeled completed.

All FOTs can read the task register. Only the owner can start/upload/submit. Photos themselves are restricted to FM and the submitting owner. Administrative writes require FM. A task's assignment or evidence-policy change starts a new cycle. Review calls use an optimistic version to reject stale approvals.

## Reminders and integration boundaries

Assignment creates an immediate outbox item; delivery starts on the next worker run (normally within a minute plus Cloud Run startup/provider latency). Normal follow-ups occur after 24 hours; urgent/critical after 3 hours. Awaiting-approval reminders go to FM. Reminders continue until FM approval or cancellation; rejection resumes them immediately. Quiet hours apply to reminders, escalations and summaries, not OTP or workflow events.

Google adapters are real API implementations, but local tests use explicit file-backed adapters. Production refuses local mode. No connector session from this chat becomes an application credential. Provision the dedicated Workspace sender and grant application consent using the supplied operator workflow.

No public admin password, public signup, frontend credential, or automatic AI approval exists. AI is optional and produces a reviewable draft only. Without credentials, the assistant explicitly returns a deterministic summary.
