import { google } from "googleapis";
import { Readable } from "node:stream";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { config } from "./config.js";
import { db } from "./db.js";
import { DateTime } from "luxon";
const localDir = new URL("../.local/", import.meta.url);
function auth() {
  const o = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
  );
  o.setCredentials({ refresh_token: config.GOOGLE_REFRESH_TOKEN });
  return o;
}
const opts = { timeout: 20000, retry: false };
export async function sendMail(to, subject, body, key) {
  if (config.INTEGRATION_MODE === "local") {
    await mkdir(localDir, { recursive: true });
    await writeFile(
      new URL(`mail-${key}.json`, localDir),
      JSON.stringify({ to, subject, body }),
    );
    return `local-${key}`;
  }
  const safe = (s) => s.replace(/[\r\n]/g, " ");
  const raw = [
    `From: ${safe(config.GOOGLE_SENDER)}`,
    `To: ${safe(to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `Message-ID: <${key}@facilityops.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  const r = await google
    .gmail({ version: "v1", auth: auth() })
    .users.messages.send(
      {
        userId: "me",
        requestBody: { raw: Buffer.from(raw).toString("base64url") },
      },
      opts,
    );
  return r.data.id;
}
async function folder(drive, parent, name) {
  const key = `${parent}/${name}`;
  let record = await db.driveFolder.findUnique({ where: { key } });
  if (!record) {
    const generated = (
      await drive.files.generateIds({ count: 1, space: "drive" }, opts)
    ).data.ids[0];
    record = await db.driveFolder.upsert({
      where: { key },
      create: { key, driveId: generated },
      update: {},
    });
  }
  const id = record.driveId;
  try {
    await drive.files.get(
      { fileId: id, fields: "id", supportsAllDrives: true },
      opts,
    );
    return id;
  } catch (e) {
    if (e.code !== 404 && e.response?.status !== 404) throw e;
  }
  try {
    await drive.files.create(
      {
        requestBody: {
          id,
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parent],
        },
        fields: "id",
        supportsAllDrives: true,
      },
      opts,
    );
  } catch (e) {
    if (e.code !== 409 && e.response?.status !== 409) throw e;
    await drive.files.get(
      { fileId: id, fields: "id", supportsAllDrives: true },
      opts,
    );
  }
  return id;
}
export async function uploadEvidence(e, task) {
  if (config.INTEGRATION_MODE === "local") {
    await mkdir(localDir, { recursive: true });
    await writeFile(new URL(`${e.id}.jpg`, localDir), e.bytes);
    return `local-${e.id}`;
  }
  const settings = await db.settings.findUnique({ where: { id: "global" } });
  if (!settings?.driveRootId)
    throw new Error("Private Drive root is not configured");
  const drive = google.drive({ version: "v3", auth: auth() });
  const permissions = await drive.permissions.list(
    {
      fileId: settings.driveRootId,
      fields: "permissions(type)",
      supportsAllDrives: true,
    },
    opts,
  );
  if (
    permissions.data.permissions?.some(
      (p) => p.type === "anyone" || p.type === "domain",
    )
  )
    throw new Error("Drive root must not have public or domain-wide sharing");
  const d = DateTime.fromJSDate(e.receivedAt).setZone("Asia/Kolkata");
  let parent = settings.driveRootId;
  for (const n of [
    d.toFormat("yyyy"),
    d.toFormat("MM"),
    task.floor,
    `FO-${task.number}`,
  ])
    parent = await folder(drive, parent, n);
  // Persist a preallocated ID before upload: retries use the same Drive object.
  let id = e.driveId;
  if (!id) {
    id = (await drive.files.generateIds({ count: 1, space: "drive" }, opts))
      .data.ids[0];
    await db.evidence.update({ where: { id: e.id }, data: { driveId: id } });
  }
  try {
    await drive.files.get(
      { fileId: id, fields: "id", supportsAllDrives: true },
      opts,
    );
    return id;
  } catch (err) {
    if (err.code !== 404 && err.response?.status !== 404) throw err;
  }
  await drive.files.create(
    {
      requestBody: {
        id,
        name: `${e.kind}-cycle${e.cycle}-${e.id}.jpg`,
        parents: [parent],
        appProperties: { evidenceId: e.id, sha256: e.sha256 },
      },
      media: {
        mimeType: "image/jpeg",
        body: Readable.from(Buffer.from(e.bytes)),
      },
      fields: "id",
      supportsAllDrives: true,
    },
    opts,
  );
  return id;
}
export async function downloadEvidence(e) {
  if (config.INTEGRATION_MODE === "local")
    return readFile(new URL(`${e.id}.jpg`, localDir));
  const r = await google
    .drive({ version: "v3", auth: auth() })
    .files.get(
      { fileId: e.driveId, alt: "media", supportsAllDrives: true },
      { ...opts, responseType: "arraybuffer" },
    );
  return Buffer.from(r.data);
}
export async function createRoot() {
  if (config.INTEGRATION_MODE === "local") return "local-root";
  return (
    await google.drive({ version: "v3", auth: auth() }).files.create(
      {
        requestBody: {
          name: "FacilityOps Private Evidence",
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      },
      opts,
    )
  ).data.id;
}
