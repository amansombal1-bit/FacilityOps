# Cloud Run deployment runbook

**Not executed against a live cloud account in this session.** The supplied configuration requires a billed GCP project, administrator-authorized Workspace OAuth credentials, and an operator with the relevant IAM permissions. Terraform and gcloud resources must be applied and smoke-tested in staging before production.

## 1. Infrastructure

Install gcloud, Docker and Terraform on an operator workstation. Authenticate using your approved organization identity. Run Terraform in `deploy/` with separate, access-controlled remote state per environment. Terraform state is not a secret store. Secret versions and DB passwords are deliberately not created by Terraform here.

```bash
cd deploy
terraform init
terraform fmt
terraform validate
terraform plan -var='project_id=YOUR_STAGING_PROJECT' -var='environment=staging'
terraform apply -var='project_id=YOUR_STAGING_PROJECT' -var='environment=staging'
```

The configuration creates:

- Cloud SQL PostgreSQL 16 with regional HA, daily backups, 14 retained backups, 7-day transaction logs/PITR and deletion protection.
- Artifact Registry, runtime identity, Scheduler invoker identity.
- Secret Manager containers and narrowly scoped access for runtime.
- Cloud SQL client permission for runtime.

Cloud SQL uses a public IP without authorized client networks; the app connects over the authenticated Cloud SQL Unix socket. Do not add `0.0.0.0/0` as an authorized network. Organizations requiring private-only IP must add an approved VPC/Private Service Access configuration and Cloud Run network attachment before deploying.

Create a dedicated SQL user and strong password using Cloud SQL's protected UI/operator process. Create `facilityops` database if not already created. Prefer separate migration and runtime DB roles: migrations need DDL, while the runtime needs only the table/sequence operations used by the app and cannot modify Audit records (database trigger also guards update/delete). Do not use postgres superuser for application traffic. The sample deployment uses one DATABASE_URL for simplicity; split it for migration IAM/DB-role isolation before a hardened rollout.

## 2. Secrets

Populate existing Secret Manager secrets through its console or stdin/file-based secure tooling. Avoid secret values in gcloud arguments/history:

| Secret                  | Value                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| fo-database-url         | `postgresql://APP_USER:URL_ENCODED_PASSWORD@localhost/facilityops?host=/cloudsql/PROJECT:REGION:INSTANCE&connection_limit=5&pool_timeout=10` |
| fo-otp-secret           | Independent cryptographically random string, at least 32 characters                                                                          |
| fo-job-secret           | Separate random string, at least 32 characters                                                                                               |
| fo-google-client-id     | Workspace-approved OAuth client ID                                                                                                           |
| fo-google-client-secret | OAuth client secret                                                                                                                          |
| fo-google-refresh-token | Dedicated sender offline refresh token                                                                                                       |
| fo-google-sender        | Consenting verified mailbox address                                                                                                          |

Grant the deployer only the necessary Cloud Run deploy, service-account actAs, Artifact Registry, Cloud Build, Scheduler and secret-version management permissions. The worker invoker needs only roles/run.invoker on the worker job. Cloud Build needs permissions to build/push to the repository; service-account creation alone does not grant a developer deployment permission.

## 3. Build immutable image

From repository root:

```bash
gcloud builds submit --project YOUR_PROJECT --config deploy/cloudbuild.yaml --substitutions _REGION=asia-south1 .
```

Record the output image URI with its BUILD_ID tag, preferably deploy by digest after recording it. The image runs as the non-root node user. Neither `.env`, tests, local evidence nor tokens are copied. Production startup rejects missing configuration, non-HTTPS APP_ORIGIN and local integration mode.

## 4. Migrate and deploy

Set non-secret deployment parameters:

```bash
export PROJECT_ID=YOUR_PROJECT
export REGION=asia-south1
export IMAGE=asia-south1-docker.pkg.dev/YOUR_PROJECT/facilityops/app:BUILD_ID
export SQL_CONNECTION=YOUR_PROJECT:asia-south1:facilityops-staging
export RUNTIME_SA=facilityops-runtime@YOUR_PROJECT.iam.gserviceaccount.com
export SCHEDULER_SA=facilityops-scheduler@YOUR_PROJECT.iam.gserviceaccount.com
export APP_ORIGIN=https://YOUR_FINAL_HOST
bash deploy/deploy.sh
```

The script deploys/runs a migration job before deploying web/API; creates a separate worker job; and schedules it every minute in Asia/Kolkata through Cloud Scheduler's authenticated OAuth call to the Cloud Run Jobs API. No public scheduler endpoint exists. Overlapping workers claim jobs with PostgreSQL row locks. Web/API can scale to zero; jobs still run.

If the Cloud Run URL is not yet known, use a temporary valid HTTPS APP_ORIGIN for initial deployment. Login intentionally fails origin checks until you update it. Get the actual service URI, set APP_ORIGIN to it and update both application and worker environment. Do not use an allow-all origin. For a custom hostname, configure an approved Cloud Run domain mapping where supported or an external HTTPS load balancer with a serverless NEG, configure DNS and a managed certificate, then update APP_ORIGIN everywhere. Do not declare the hostname live until certificate, DNS and cookie behavior are verified.

Cloud Run terminates HTTPS. The app trusts one proxy hop; route traffic only through the intended platform entry point. Database connection budgets must cover up to 5 service instances × 5 connections plus scheduled workers and migrations. Tune instance caps and worker batch size for your Cloud SQL tier and workload.

## 5. First FM

Create a temporary Cloud Run job using the same runtime image, Cloud SQL connection and secrets, with command `node` and argument `server/bootstrap.js`. Add BOOTSTRAP_EMAIL and BOOTSTRAP_NAME only to that job. Execute once, verify successful audit creation, then delete the bootstrap job. Do not create a public bootstrap route. Provision other users in the authenticated Team page.

Sign in, configure the Drive root, and perform the acceptance checks below.

## 6. Monitoring and release gates

- `/health/live`: process liveness. `/health/ready`: verifies database connectivity. Neither claims Workspace is connected.
- Configure a Cloud Monitoring HTTPS uptime check on readiness, a notification channel controlled by your operators, and alerts for non-2xx/latency and Cloud Run Job execution failure.
- Alert on Cloud Scheduler delivery failures and last successful worker execution age above 3 minutes.
- Add a scheduled DB metric for old Pending jobs, Failed/Uncertain jobs and email attempts marked Started beyond the lease. The Automation UI exposes job state but is not a substitute for alerts.
- Central logs are structured JSON and redact cookies/tokens. Export audit records to separately controlled storage with your retention policy. Restrict Cloud Logging access.
- Verify a new OTP arrives before expiry; test a real mailbox outside the sender account; check spam folders and Gmail acceptance/error logs.
- Create a task with before/photo/GPS requirements on a real mobile phone; test camera denial and location denial. Check stored Drive ACLs and unauthorized evidence access.
- Test urgent cadence with clock-controlled staging data, overdue escalation, quiet hours, two worker invocations, rejection and approval. No reminder should be newly queued for a closed task.
- Restore a backup into a separate staging instance and verify task/evidence references; Drive data needs a separate organizational recovery plan.
- Run `npm test` against PostgreSQL 16 and the browser suite; load-test your intended user/task count. PGlite tests do not validate real multi-process PostgreSQL locking or Cloud Run limits.
- Validate Terraform with your provider version, build the Docker image and verify all commands in staging. These infrastructure executions were not possible in the authoring session.

## Rollback

Keep the previous immutable image/revision. Roll back Cloud Run traffic to the prior compatible revision. Database migrations are forward-only; do not undo a schema migration by dropping production data. For incompatible changes prepare a forward repair or restore into a new instance after your backup/recovery review. Restore matching server secrets for encrypted pending OTP jobs; changing JOB_SECRET invalidates pending encrypted payloads. Never log token/plaintext payloads while investigating.

Official scheduling reference: https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule
