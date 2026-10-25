# Security, reliability and operating limits

## Authentication and authorization

- OTP: cryptographic six-digit generation, keyed HMAC digest at rest, five-minute expiry, five attempts, 60-second resend cooldown, per-IP and per-email durable rate buckets. Unknown/inactive account requests return the same message. OTP outbox content is AES-256-GCM encrypted with JOB_SECRET, scrubbed after successful delivery, and skipped after expiry.
- Sessions: random 256-bit bearer in an HttpOnly SameSite=Strict cookie; only its SHA-256 hash is stored. Eight-hour absolute expiry, logout revocation, current-user active checks, role-change/deactivation revocation. Production uses Secure and the __Host- prefix without a Domain attribute.
- CSRF: all API writes require the exact configured Origin; authenticated writes additionally require a session-bound X-CSRF-Token returned only to authenticated clients. CORS is not opened cross-origin. No state changes on GET.
- FM-only task administration/approval, user/settings/audit/job APIs. Owner-only start/capture/upload/submit. All FOTs may read all-floor tasks, as requested. Photos are private to FM and their submitting owner.
- Administrative and task mutations use serializable transactions and persistent audit/outbox rows. Stale FM reviews are rejected by task version. Audit update/delete is blocked by a database trigger; database owners remain privileged, so export to an independently controlled log sink.
- Public signup and admin-password routes do not exist. The operator bootstrap stops when an FM already exists.

## Evidence

Server accepts at most 10 MB per image, verifies by decoding JPEG/PNG/WebP (25-million-pixel ceiling), rejects animated/multipage input, normalizes orientation, strips EXIF, resizes within 2400 pixels, and encodes JPEG. GPS is explicitly stored as structured fields with accuracy and GPS timestamp. Image file extensions or client MIME alone never authorize an upload.

A challenge binds a fresh-camera submission to an owner, task and evidence cycle, with a ten-minute expiry and one-use marking. The UI uses getUserMedia, not a hidden gallery input, when fresh camera capture is required. Required GPS errors are blocking. Before photos must precede the start transition. Completion photos require InProgress. Only Ready evidence in the current owner's current cycle can support submission. A new rejection or policy/owner change cannot reuse a previous cycle's photos.

**Browser camera and GPS assertions can be forged by a determined client.** A browser cannot provide hardware attestation or tamper-proof geolocation. This build does not claim otherwise. It does not verify that the photographed object is the facility, infer work completion from pixels, or restrict GPS to a geofence. FM must verify the evidence. Stronger assurance needs a managed native/device-attestation solution.

Images stage in PostgreSQL until durable private Drive upload succeeds, then staged bytes are cleared. Production Cloud SQL must use encrypted managed storage and protected backups. Failed uploads retain bytes for retry; monitor this volume. Idempotency keys are unique and replay checks task, uploader and content hash. Drive IDs are persisted before creation for retry recovery. The API never creates public permissions and does not send permanent public URLs.

Private folder ACLs remain an operational trust boundary. Someone with administrative Drive access could change sharing outside the app. Root sharing is checked on upload; schedule independent Workspace ACL audits, restrict integration-account access and retain Drive audit logs. Do not assume the app can prevent an external Drive administrator from changing permissions.

## Queue / email semantics

PostgreSQL outbox is transactional with task changes. Scheduler sweeps use an advisory transaction lock; claims use FOR UPDATE SKIP LOCKED. Jobs have leases, backoff and a five-attempt budget. Upload retries reuse the same Drive file ID. Worker job max execution is below the ten-minute lease.

Gmail send has no exactly-once idempotency guarantee. A stable Message-ID is useful for investigation but is not provider deduplication. A definitive throttling/service rejection can retry; a timeout, worker interruption during send, or local failure after an external send is marked **Uncertain** instead of risking blind duplication. EmailAttempt stores Started/Accepted/Rejected/Uncertain and provider IDs where known. A Gmail Accepted result means accepted by Gmail, not delivered/read.

Operational reconciliation for Uncertain:

1. Find the job ID / Message-ID in your sender mailbox or Workspace email log search using an authorized operator account.
2. If sent, mark the job Done through an audited operator database transaction.
3. If conclusively not accepted, record an audit entry then reset the same job to Pending; never reset solely because a recipient has not noticed the mail.
4. If indeterminate, decide manually whether a clearly marked follow-up is appropriate. There is intentionally no blind Retry button for uncertain mail.

No Gmail inbox-read scope is requested for automatic reconciliation. Any extra diagnostic scope needs a separate authorization decision. Delivery receipts/bounces are not automatically ingested in this version.

Completed/cancelled tasks are excluded from sweep and stale queued reminders are skipped. An external provider send already in flight when an FM closes a task cannot be recalled; this is a distributed-system boundary, not automatic reopening. No reminder ever changes task status. Quiet-hour boundaries and reports use Asia/Kolkata; timestamps are stored as UTC instants.

## Retention, backup and recovery

The evidenceRetentionDays setting is an explicit **review threshold**, not an automatic deletion timer. No evidence/audit is silently deleted by a background task. Expired sessions, OTPs, rate buckets and camera challenges are cleaned by sweeps. Successful OTP jobs have encrypted content removed; dead/uncertain OTP jobs need operator retention cleanup.

Before launch, your data owner must define retention for closed-task photos, failed-upload bytes, emails/job records, task history, audit logs and backups. Produce an approved deletion manifest for closed tasks beyond retention, honor legal/operational holds, export required records, delete private Drive objects through an authorized operator, then record deletion/tombstone metadata and audit the action. Automated evidence purge and legal-hold UI are not implemented. Keep audit logs in separately controlled retention storage and confirm backup expiry rather than assuming a Drive delete removes all backups.

Cloud SQL HA/PITR configuration is supplied, but a restore drill and Drive recovery/export policy remain required. Validate recovery objectives using actual data sizes. Do not use test PGlite as your production database.

## Monitoring / scale

pino structured HTTP/worker logs omit bodies, cookies, authorization headers and CSRF tokens. Database job state and attempts support operational review. Cloud Monitoring alert setup is an operator deployment step; no live alert channel was connected in this session. Secrets are never bundled into client code. AI task data is external processing only when an administrator supplies a provider key; no autonomous actions are enabled.

This is an implementation for a bounded facility team, not a benchmarked multi-tenant SaaS. The reports/scheduler currently read all tasks/open tasks and the register exports at most 10,000 filtered rows. Histories display the most recent 200 events per task; audit/jobs pages are paginated/bounded. For large datasets introduce aggregate reporting queries and batched scheduler scans before increasing workload. The app has one organizational workspace; hard-coded display name “Alwar workspace” can be edited in client/src/main.jsx.

No independent penetration test, Cloud Run soak test, disaster-recovery exercise or real-device GPS/camera validation has been completed. Run these acceptance gates before describing the deployment as production-ready.
