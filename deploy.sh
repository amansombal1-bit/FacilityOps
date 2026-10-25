#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set your billed Google Cloud project}"
: "${REGION:=asia-south1}"
: "${IMAGE:?Set the built immutable Artifact Registry image URI}"
: "${SQL_CONNECTION:?Set project:region:instance}"
: "${APP_ORIGIN:?Set final https URL; for first deploy use a temporary https origin then update}"
: "${RUNTIME_SA:?Set runtime service account email}"
: "${SCHEDULER_SA:?Set scheduler service account email}"
# Secrets must exist already. Never put their values in this script.
secrets='DATABASE_URL=fo-database-url:latest,OTP_SECRET=fo-otp-secret:latest,JOB_SECRET=fo-job-secret:latest,GOOGLE_CLIENT_ID=fo-google-client-id:latest,GOOGLE_CLIENT_SECRET=fo-google-client-secret:latest,GOOGLE_REFRESH_TOKEN=fo-google-refresh-token:latest,GOOGLE_SENDER=fo-google-sender:latest'
env="NODE_ENV=production,INTEGRATION_MODE=google,APP_ORIGIN=$APP_ORIGIN"
common=(--project "$PROJECT_ID" --region "$REGION" --image "$IMAGE" --service-account "$RUNTIME_SA" --set-cloudsql-instances "$SQL_CONNECTION" --set-secrets "$secrets" --set-env-vars "$env")
gcloud run jobs deploy facilityops-migrate "${common[@]}" --command node --args node_modules/prisma/build/index.js,migrate,deploy --max-retries 0 --task-timeout 600s
gcloud run jobs execute facilityops-migrate --project "$PROJECT_ID" --region "$REGION" --wait
gcloud run deploy facilityops "${common[@]}" --allow-unauthenticated --port 8080 --memory 1Gi --cpu 1 --concurrency 20 --max-instances 5 --min-instances 0 --timeout 60 --startup-probe httpGet.path=/health/ready,initialDelaySeconds=0,timeoutSeconds=5,periodSeconds=10,failureThreshold=12 --liveness-probe httpGet.path=/health/live,timeoutSeconds=5,periodSeconds=30,failureThreshold=3
gcloud run jobs deploy facilityops-worker "${common[@]}" --command node --args server/worker.js --memory 1Gi --cpu 1 --tasks 1 --parallelism 1 --max-retries 1 --task-timeout 540s
gcloud run jobs add-iam-policy-binding facilityops-worker --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$SCHEDULER_SA" --role roles/run.invoker
uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/facilityops-worker:run"
if gcloud scheduler jobs describe facilityops-minute --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http facilityops-minute --project "$PROJECT_ID" --location "$REGION" --schedule '* * * * *' --time-zone Asia/Kolkata --uri "$uri" --http-method POST --oauth-service-account-email "$SCHEDULER_SA" --oauth-token-scope https://www.googleapis.com/auth/cloud-platform --message-body '{}'
else
  gcloud scheduler jobs create http facilityops-minute --project "$PROJECT_ID" --location "$REGION" --schedule '* * * * *' --time-zone Asia/Kolkata --uri "$uri" --http-method POST --oauth-service-account-email "$SCHEDULER_SA" --oauth-token-scope https://www.googleapis.com/auth/cloud-platform --message-body '{}'
fi
printf 'Deployment commands completed. Verify Workspace, evidence, scheduler, HTTPS and backups before go-live.\n'
