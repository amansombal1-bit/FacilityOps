# REST API and authorization

JSON errors use `{ "error": "message" }`. Invalid inputs 400; unauthenticated 401; permission/CSRF 403; missing resources 404; conflicting state/version 409; rate limits 429. API writes require exact Origin. Authenticated writes additionally require X-CSRF-Token from GET /api/me. Use cookie credentials; do not store bearer/session tokens in browser storage.

| Method / endpoint                 | Permission / purpose                                            |
| --------------------------------- | --------------------------------------------------------------- |
| POST /api/auth/request            | Public, rate limited; `{email}`; generic response               |
| POST /api/auth/verify             | Public, rate limited; `{email,otp}`; sets session cookie        |
| GET /api/me                       | Active session; user, CSRF token and integration mode           |
| POST /api/auth/logout             | Active session + CSRF; revokes session                          |
| GET /api/people                   | All active users; minimal names/IDs/roles                       |
| GET /api/tasks                    | All active users; 50 rows/page with filters                     |
| GET /api/tasks/:id                | All active users; evidence metadata and latest history          |
| POST /api/tasks                   | FM; creates task and assignment outbox item                     |
| PATCH /api/tasks/:id              | FM, Open/InProgress only; include version                       |
| POST /api/tasks/:id/start         | Assigned owner only; requires ready before photo if configured  |
| POST /api/tasks/:id/capture       | Assigned owner only; short-lived one-use challenge              |
| POST /api/tasks/:id/evidence      | Assigned owner only; multipart photo + metadata, returns 202    |
| POST /api/evidence/:id/retry      | FM or uploader; only failed upload jobs                         |
| GET /api/evidence/:id/photo       | FM or uploader; private, no-store JPEG response                 |
| POST /api/tasks/:id/submit        | Assigned owner only; correctiveAction, resolutionNotes          |
| POST /api/tasks/:id/approve       | FM, AwaitingApproval and matching version only                  |
| POST /api/tasks/:id/reject        | FM, AwaitingApproval; version and reason; new cycle             |
| POST /api/tasks/:id/cancel        | FM, unresolved; version and reason                              |
| GET /api/tasks.csv                | FM; same filters, max 10,000; formula-safe cells                |
| GET /api/reports?days=7           | Active users; day/week/month throughput and live backlog        |
| GET /api/users                    | FM; all accounts                                                |
| POST /api/users                   | FM; name,email,role; no public signup                           |
| PATCH /api/users/:id              | FM; name,role,active; last-FM and pending-task protections      |
| GET/PATCH /api/settings           | FM; escalation, quiet hours, daily summary, retention threshold |
| POST /api/integrations/drive-root | FM; creates the initial private app-owned Drive root            |
| GET /api/audit?page=1             | FM; 100 rows/page                                               |
| GET /api/jobs                     | FM; latest 100 jobs and email attempts; no secret payloads      |
| POST /api/ai/follow-up            | FM; rate-limited optional AI draft, no actions                  |
| GET /health/live                  | Liveness only                                                   |
| GET /health/ready                 | Database readiness only                                         |

Task input: title, description, category, floor, room, assignedToId (active FOT UUID), priority (Normal/Urgent/Critical), deadline (ISO UTC), beforeRequired, gpsRequired, cameraRequired. Creation requires a future deadline. Edit policy changes may begin a new evidence cycle.

Register filters: floor, category, assignedToId, priority, status, overdue=true, from/to (ISO creation times), page. Status values: Open, InProgress, AwaitingApproval, Completed, Cancelled. Dates rendered to users use IST.

Evidence multipart fields: photo (JPEG/PNG/WebP; <=10 MB), kind (before/after), idempotencyKey (UUID), captureId (camera challenge), captureAt (ISO), source (camera/gallery), optional latitude/longitude/accuracy/gpsAt (all required by GPS-enabled task policy). Fresh camera captures must be under ten minutes old, and GPS fixes within two minutes of capture. The server records its own receivedAt. Retry a network-ambiguous upload with the same idempotency key and same image, not a new key.

No task DELETE endpoint is exposed; FM cancellation preserves history. No API allows FOT to assign, reprioritize or approve. No endpoint returns secret or raw OTP payloads.
