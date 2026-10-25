# Supplied starter review

Inspected: `facilityops_production_starter.zip`, provided during this conversation. The original archive is preserved separately and was not overwritten.

Files reviewed: README, server/web package manifests, Prisma schema, auth, Express entry point, email, Drive, reminders, and React frontend. The requested React/Vite, Express, PostgreSQL and Prisma architecture is retained. Most implementation files were replaced because the starter explicitly left important production work unfinished.

| Finding in supplied starter                                                        | Delivered correction                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Prisma enum definitions on single lines fail Prisma 6 validation (confirmed P1012) | Formatted valid schema, generated client and committed SQL migrations         |
| No migration files                                                                 | Initial migration, migration lock, append-only audit migration                |
| JWT cookie cannot be revoked at logout on server                                   | Hashed opaque server-side session records, revocation and absolute expiry     |
| No explicit CSRF check                                                             | Exact Origin and session-bound CSRF header                                    |
| OTP update/check/consume operations not one transaction; cooldown absent           | Serializable verification, durable attempts/cooldown/rate buckets             |
| Unhandled async rejection concerns in Express 4 handlers                           | Express 5 async error propagation and uniform validation/error middleware     |
| Owner status patch could bypass review stages; evidence submit had no status guard | Restricted transition endpoints and immutable completed state                 |
| FM could submit another user's evidence                                            | Submission/start/upload restricted to the actual assignee                     |
| FOT list limited to own tasks despite all-floor requirement                        | All-floor register plus an own-assignment dashboard                           |
| File checks trusted MIME supplied by client                                        | Decode, size/pixel limit, normalize/reencode image                            |
| GPS timestamp replaced by server now                                               | Separate client capture/GPS and server receipt timestamps                     |
| Completion/before fields overwritten on rejection                                  | Multiple evidence records and per-rework cycles; history preserved            |
| Drive upload synchronous; retries can duplicate/leave partial state                | Staged bytes, durable jobs, preallocated Drive IDs, idempotency keys          |
| One Drive folder, no viewer endpoint                                               | Year/month/floor/task folders and authorized evidence proxy                   |
| node-cron tied to web instance; no concurrency controls                            | Managed-scheduler configuration and durable PostgreSQL claims/leases          |
| Fire-and-forget assignment mail can be lost                                        | Outbox written in the task transaction                                        |
| Escalation only TODO; approval/rejection notifications absent                      | Configurable escalation, workflow notifications and FM daily summary          |
| SMTP integration needs credentials; no authorization setup                         | Gmail send-only OAuth, localhost authorization helper and Workspace guide     |
| No user provisioning UI/bootstrap/tests/reports                                    | FM-only management, operator bootstrap, reports/CSV, audit/settings and tests |

## Existing data caution

The delivered migrations create a fresh schema. They are **not an in-place migration of a populated starter database**. The starter uses different IDs/column names/status enum values. If it already contains real data, take backups and build/test an explicit import mapping before pointing this application at it; never use db push or reset against that database. No existing production dataset was provided or altered.
