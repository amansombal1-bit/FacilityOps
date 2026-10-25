# Setup and Google Workspace authorization

## Environment separation

Use different GCP projects, PostgreSQL instances, OAuth clients, sender/test accounts, Drive roots and secrets for staging and production. Do not share OTP_SECRET or JOB_SECRET across environments. APP_ORIGIN must be the exact browser origin (scheme, host, port; no trailing slash). Production must use HTTPS and INTEGRATION_MODE=google. VITE_* variables are deliberately unnecessary: the browser uses same-origin `/api`.

Generate two independent 32-byte random secrets, for example `openssl rand -hex 32`; place them in `.env` locally or Secret Manager in production. Do not put secret values in shell history, source, CI logs, chat messages, or frontend assets.

For local development set `INTEGRATION_MODE=local`. This explicitly writes generated mail and JPEG evidence under `.local/`; the UI displays a development notice. Inspect these local mail files to obtain test OTPs. They are never sent to real recipients. `.local/` and `.env` are excluded from source packages and Docker builds. Protect your workstation and delete local test evidence when done.

## PostgreSQL and first FM

Set LOCAL_DB_PASSWORD in your shell, run `docker compose up -d postgres`, and set DATABASE_URL to the matching local connection. URL-encode password characters where necessary. Run Prisma generate and migrate deploy as shown in README.

Set BOOTSTRAP_EMAIL and BOOTSTRAP_NAME temporarily in the operator environment. Run `node --env-file=.env server/bootstrap.js`. It creates the first FM once, records an audit entry, and refuses if any FM exists. There is no password. Remove bootstrap variables afterwards. Sign in through email OTP, then create approved FOTs and additional FMs in Team.

An FM cannot deactivate the final active FM. Pending tasks must be reassigned before an owner is deactivated or promoted. Role changes and deactivation revoke existing sessions. Every request also checks current active status.

## Gmail / Drive OAuth implementation

This implementation uses a dedicated Workspace user OAuth refresh token. It does not use SMTP passwords or domain-wide delegation in application code.

1. Create a Cloud project under your organization's control and enable Gmail API and Google Drive API.
2. Configure Google Auth Platform / OAuth consent. For an application limited to your Workspace organization choose Internal where supported. Enter correct application name, support address, and organization details. If External, complete any verification required by the chosen scopes and audience before production; test-mode consent is not a durable production credential.
3. Create an OAuth web client with exactly this localhost redirect for the operator setup: `http://127.0.0.1:53682/oauth/callback`. A client secret belongs only on the operator workstation and server Secret Manager.
4. Request only these application scopes:
   - `https://www.googleapis.com/auth/gmail.send` — send mail without reading mailboxes.
   - `https://www.googleapis.com/auth/drive.file` — create/access application-created Drive files.
   - `openid` and `email` — verify that the consenting identity is the configured sender during setup.
5. Ask your Workspace administrator to allow/trust this OAuth client and requested scopes in App access control if organizational policies block access. User consent does not override administrator restrictions.
6. Provision a dedicated, licensed sender mailbox, such as an address your organization owns. Set GOOGLE_SENDER to that exact consenting mailbox. This implementation's setup verifies the ID token and requires the same verified email. Arbitrary From addresses and unverified aliases are not supported by the setup. Configure SPF/DKIM/DMARC for your organization through your email administrator and test recipient delivery; successful API acceptance alone is insufficient.
7. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_SENDER in a local protected environment. Run `node --env-file=.env server/google-setup.js` **on your own workstation**, then open the printed consent link on that same machine. The listener binds only to 127.0.0.1, checks random state, expires after ten minutes, and validates the verified sender ID token.
8. The refresh token is saved once to `.google-oauth-secret.json` with mode 0600. Transfer its GOOGLE_REFRESH_TOKEN value to Secret Manager through a secure operator workflow; delete the local file afterwards. Never commit or display the token. The script refuses to overwrite an existing secret file.
9. Load the Google variables into both application and worker. Set INTEGRATION_MODE=google. Log in as FM and choose Automation → Create private evidence folder. This creates an app-owned root accessible with drive.file; simply entering an arbitrary existing folder ID would not grant drive.file access.
10. Keep the root private to the dedicated integration account and explicit, authorized administrators. Do not enable public/domain-wide sharing. FM users view photos through the application authorization proxy, so broad Drive ACL sharing is unnecessary. The adapter rejects root permissions of type `anyone` or `domain`.
11. Verify actual Gmail delivery and an evidence round-trip. Review provider quota, mailbox send limits, revoked-token behavior, organizational data policies and token rotation before rollout.

Evidence is organized in app-created folders: year / month / floor / FO-task-number, using Asia/Kolkata for date grouping. Files have preallocated Drive IDs persisted before upload. Retrying the same upload can retrieve the same object rather than create another. The normalized JPEG hash, client GPS time, client capture time and server received time are stored separately.

### If your organization requires service-account delegation

Workspace domain-wide delegation is an alternative authorization model, **not enabled in this build**. It requires a super administrator to authorize the service account's OAuth client ID and explicit scopes, and code to impersonate a licensed user. Do not substitute a Cloud Run runtime identity expecting it to have Gmail access. Using the delivered user-OAuth flow avoids broad domain-wide delegation. A policy requiring delegation is a separate adapter change and acceptance test.

## Optional AI

Set AI_API_KEY as a server-side secret and optionally AI_MODEL, then add the secret mapping to the deployed application service. The endpoint calls OpenAI Responses with store=false, a bounded output, a 30-second timeout, and only current selected task fields. It sends task titles, owner names, categories, priorities, status and deadlines to that provider. Get organizational approval for that data processing. It does not send images or GPS, execute actions, send email, or approve tasks. Validate the draft against the source facts shown in the UI.

## Official references

- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Drive scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Workspace app access controls: https://support.google.com/a/answer/7281227
- Delegation alternative: https://developers.google.com/identity/protocols/oauth2/service-account
