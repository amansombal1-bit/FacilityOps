# Verification and delivery status

Verified on 25 October 2026. **No public production deployment was performed.** This package is a working implementation with local validation, not a claim of operational production certification.

## Executed checks

| Check                                   | Observed result                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Supplied starter Prisma schema          | Failed validation with P1012 (single-line enum syntax); replaced                             |
| Delivered Prisma schema format/generate | Passed; Prisma Client 6.19.3 generated                                                       |
| Initial and audit SQL migrations        | Executed against ephemeral PGlite PostgreSQL engine                                          |
| Unit and API integration suite          | **20 tests passed**, 2 files; actual Express + Prisma + SQL engine                           |
| Production Vite build                   | Passed; bundled React app served by Express                                                  |
| Production dependency audit             | **0 known vulnerabilities** reported by npm audit --omit=dev at verification time            |
| Browser smoke test                      | Passed with Playwright + headless Chromium                                                   |
| Desktop/mobile inspection               | Reviewed rendered desktop 1440px and mobile 390px layouts; no page-level horizontal overflow |
| Browser JS errors                       | Zero observed in smoke flow                                                                  |
| Deployment script shell syntax          | bash -n passed                                                                               |
| Terraform file syntax                   | Parsed as HCL with 9 resource blocks; provider-level terraform validate/apply not executed   |

The browser flow used the actual app and database: work-email request → encrypted OTP outbox → local mail adapter → six-digit verification → session cookie → create task → open detail → Team and Automation pages → mobile navigation → logout. No production user/session bypass or seeded public admin credential exists. Test accounts are disposable fixtures. Initial browser download failed in this environment; the smoke suite used bundled headless Chromium with browser web-security protections enabled.

API coverage includes unauthenticated denial, Origin/CSRF checks, FOT privilege denial, all-floor read access, owner-only mutation, MIME spoof rejection, mandatory before/completion photos, GPS/camera policy, upload idempotency and restricted photo access, corrective action, stale approval version, rejection/new evidence cycle, FM-only completion, OTP expiry/attempt lockout/one-use/cooldown, unknown account handling, session revocation, final-FM protection, append-only audit, urgent reminder/escalation deduplication, cancellation suppression and recovery of interrupted email jobs.

PGlite is an embedded PostgreSQL engine reached over its TCP compatibility layer. It validates SQL and Prisma behavior, but **does not substitute for a real PostgreSQL 16 multi-process concurrency/locking test**. The CI workflow and TEST_DATABASE_URL path are provided for that acceptance gate; no CI service was connected or run here. Camera/GPS permission behavior on actual Android/iOS hardware was not verified by the browser smoke test.

The dependency override `deepmerge-ts: ^8.0.0` resolves the reported transitive advisory through Prisma configuration tooling. Prisma generation, SQL-backed tests and build were rerun successfully with the override. Review future dependency changes through CI rather than using npm audit fix --force blindly.

## Genuine connection checklist

| Component                             | Implemented                             | Connected/verified here                                                                |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| React responsive frontend             | Yes                                     | Local production bundle + browser smoke passed                                         |
| Express REST backend                  | Yes                                     | Local API integration and browser tests passed                                         |
| PostgreSQL/Prisma                     | Yes                                     | Ephemeral SQL tests passed; no Cloud SQL instance connected                            |
| OTP/session/RBAC                      | Yes                                     | Local adapter and API/browser tests passed                                             |
| Gmail OAuth send integration          | Yes                                     | **Not connected** — Workspace OAuth credentials/consent missing                        |
| Private Google Drive evidence         | Yes                                     | **Not connected** — real authorized OAuth and private root missing                     |
| Durable queue/scheduler logic         | Yes                                     | Local sweeps/claims tested; **managed schedule not deployed**                          |
| Assignment/escalation/workflow emails | Yes                                     | Local file-backed mail tests; **no real delivery verified**                            |
| Optional AI follow-up                 | Yes                                     | Deterministic fallback implemented; **no AI API key connected or model call verified** |
| Cloud Run web/API and worker          | Config supplied                         | **Not deployed** — no authenticated GCP deployment context                             |
| HTTPS / custom domain                 | Configuration/runbook supplied          | **Not configured or verified**                                                         |
| Cloud SQL HA/backups/PITR             | Terraform supplied                      | **Not provisioned; restore not tested**                                                |
| Cloud Monitoring alerts               | Structured logs + operator instructions | **No alert channel configured**                                                        |

## Exact missing inputs/access

1. A billed Google Cloud project ID, region confirmation and authenticated deployer with Cloud Run, Cloud SQL, Artifact Registry/Cloud Build, Secret Manager, Scheduler and service-account actAs permissions.
2. A dedicated Google Workspace sender mailbox, organization-approved OAuth client ID/client secret, offline refresh token, Gmail/Drive API enablement and administrator consent/app-access approval. Use the supplied local consent helper; do not paste credentials into chat or source.
3. A PostgreSQL database/user and corresponding protected DATABASE_URL, and independently generated OTP_SECRET/JOB_SECRET. Deployment config expects Secret Manager versions to be populated.
4. The first FM's approved work email and display name, supplied only to the one-time operator bootstrap job.
5. If a custom domain is required: desired hostname and DNS/certificate configuration authority. A Cloud Run-provided HTTPS URL can be used initially after verification.
6. Optional AI provider secret, organization data-processing approval, and monitoring notification channel.

## Known limitations / release blockers

- Real Gmail/Drive, production PostgreSQL concurrency, container build on Cloud Build, Terraform/provider validation, Cloud Run deployment and managed scheduling remain unverified.
- Complete the real mobile camera/location-denial, live evidence ACL, email quota/expiry, rollback and backup restore acceptance tests in DEPLOYMENT.md before release.
- GPS/camera browser claims are not hardware-attested or tamper-proof; FM verification is essential.
- Gmail does not provide exactly-once send semantics. Uncertain outcomes require operator reconciliation; inbox delivery/bounces are not automatically confirmed.
- Retention is a configured review threshold with a documented operator deletion process. Automated evidence purging and legal-hold management UI are not implemented.
- The supplied DB migrations initialize a fresh schema. A populated starter database needs a separately tested import mapping.
- Reports/scheduler are designed for a bounded facility workspace; large-scale load testing and batched reporting/sweeps are still needed before high-volume use.
- Google Workspace domain-wide delegation is documented as an alternative, not implemented in this user-OAuth adapter.
- Root-folder creation is available to FM; moving/replacing an existing integration root uses an audited operator migration to avoid breaking historical evidence.

There is intentionally no live URL in this delivery because a successful cloud deployment and verification have not occurred.
