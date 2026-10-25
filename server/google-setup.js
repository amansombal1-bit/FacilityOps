// Operator-only localhost OAuth setup. Never expose this listener on Cloud Run.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { google } from "googleapis";
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SENDER } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_SENDER)
  throw new Error(
    "Set Google OAuth client ID, secret, and sender in the operator environment",
  );
const redirect = "http://127.0.0.1:53682/oauth/callback",
  state = randomBytes(32).toString("hex");
const client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  redirect,
);
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.file",
];
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, redirect);
    if (
      url.pathname !== "/oauth/callback" ||
      url.searchParams.get("state") !== state
    ) {
      res.writeHead(400);
      res.end("Invalid OAuth state");
      return;
    }
    if (!url.searchParams.get("code"))
      throw new Error("Consent was not granted");
    const { tokens } = await client.getToken(url.searchParams.get("code"));
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const identity = ticket.getPayload();
    if (
      !identity.email_verified ||
      identity.email.toLowerCase() !== GOOGLE_SENDER.toLowerCase()
    )
      throw new Error("Sign in with the configured sender account");
    if (!tokens.refresh_token)
      throw new Error(
        "No refresh token returned; revoke prior consent then retry",
      );
    await writeFile(
      ".google-oauth-secret.json",
      JSON.stringify(
        { GOOGLE_REFRESH_TOKEN: tokens.refresh_token, sender: identity.email },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    res.end(
      "Consent complete. Secret saved locally. Return to the operator terminal.",
    );
    server.close();
    clearTimeout(expiry);
  } catch (e) {
    res.writeHead(400);
    res.end(
      "OAuth setup failed. Check sender, consent, and existing secret file.",
    );
    console.error(e.message);
  }
});
server.listen(53682, "127.0.0.1", () =>
  console.log(
    "Open this URL on this same computer:\n" +
      client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes,
        state,
      }),
  ),
);
const expiry = setTimeout(() => {
  server.close();
  console.error("Setup expired after ten minutes");
}, 600000);
