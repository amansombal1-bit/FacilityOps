import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile } from "node:fs/promises";
import request from "supertest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
let pg, socket, db, app, crypto, worker, admin, owner, other, task;
const origin = "http://localhost:5173";
beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.INTEGRATION_MODE = "local";
  process.env.OTP_SECRET = "test-otp-secret-with-at-least-32-characters";
  process.env.JOB_SECRET = "test-job-secret-with-at-least-32-characters";
  process.env.APP_ORIGIN = origin;
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:55432/postgres?connection_limit=1";
  if (process.env.TEST_DATABASE_URL) {
    if (new URL(process.env.TEST_DATABASE_URL).pathname !== "/facilityops_test")
      throw new Error("Tests require a disposable facilityops_test database");
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: process.env },
    );
  } else {
    pg = await PGlite.create();
    for (const migration of [
      "202610250001_initial",
      "202610250002_audit_guard",
    ])
      await pg.exec(
        await readFile(
          new URL(
            "../prisma/migrations/" + migration + "/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
    socket = new PGLiteSocketServer({ db: pg, port: 55432, host: "127.0.0.1" });
    await socket.start();
  }
  ({ db } = await import("../server/db.js"));
  ({ app } = await import("../server/app.js"));
  crypto = await import("../server/crypto.js");
  worker = await import("../server/worker.js");
  await db.settings.create({ data: { driveRootId: "local-root" } });
  async function user(email, role) {
    const u = await db.user.create({
      data: { email, name: email.split("@")[0], role },
    });
    const raw = crypto.token(),
      csrf = crypto.token();
    await db.session.create({
      data: {
        id: crypto.hash(raw),
        userId: u.id,
        csrf,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { ...u, csrf, cookie: "fo_session=" + raw };
  }
  admin = await user("fm@example.test", "FM");
  owner = await user("fot@example.test", "FOT");
  other = await user("other@example.test", "FOT");
});
afterAll(async () => {
  await db?.$disconnect();
  await socket?.stop();
  await pg?.close();
});
function call(user, method, path, body) {
  let r = request(app)
    [method]("/api" + path)
    .set("Origin", origin);
  if (user) r = r.set("Cookie", user.cookie).set("X-CSRF-Token", user.csrf);
  return body ? r.send(body) : r;
}
it("blocks unauthenticated, wrong-origin, and missing-CSRF requests", async () => {
  expect((await call(null, "get", "/tasks")).status).toBe(401);
  expect(
    (
      await request(app)
        .post("/api/users")
        .set("Cookie", admin.cookie)
        .set("Origin", origin)
        .send({})
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post("/api/auth/request")
        .set("Origin", "https://evil.example")
        .send({ email: owner.email })
    ).status,
  ).toBe(403);
});
it("blocks FOT provisioning and creates a task atomically with notification", async () => {
  expect(
    (
      await call(owner, "post", "/users", {
        name: "No",
        email: "no@example.test",
        role: "FM",
      })
    ).status,
  ).toBe(403);
  const r = await call(admin, "post", "/tasks", {
    title: "Repair washroom tap",
    description: "Replace leaking valve and test for leaks.",
    category: "Plumbing",
    floor: "1",
    room: "103",
    assignedToId: owner.id,
    priority: "Urgent",
    deadline: new Date(Date.now() + 3600000).toISOString(),
    beforeRequired: true,
    gpsRequired: true,
    cameraRequired: true,
  });
  expect(r.status, r.body.error).toBe(201);
  task = r.body;
  expect(await db.job.count({ where: { taskId: task.id } })).toBe(1);
});
it("allows all-floor viewing but blocks another FOT mutations and owner priority changes", async () => {
  expect((await call(other, "get", "/tasks")).body.total).toBe(1);
  expect((await call(other, "post", `/tasks/${task.id}/start`)).status).toBe(
    403,
  );
  expect(
    (
      await call(owner, "patch", `/tasks/${task.id}`, {
        priority: "Critical",
        version: 1,
      })
    ).status,
  ).toBe(403);
  expect(
    (await call(owner, "post", `/tasks/${task.id}/approve`, { version: 1 }))
      .status,
  ).toBe(403);
});
it("requires before photo before starting and rejects fake image bytes", async () => {
  expect((await call(owner, "post", `/tasks/${task.id}/start`)).status).toBe(
    400,
  );
  const r = await call(owner, "post", `/tasks/${task.id}/evidence`)
    .field("kind", "before")
    .field("idempotencyKey", randomUUID())
    .field("captureAt", new Date().toISOString())
    .field("source", "camera")
    .attach("photo", Buffer.from("not an image"), {
      filename: "fake.jpg",
      contentType: "image/jpeg",
    });
  expect(r.status).toBe(400);
});
async function photo(
  kind,
  { source = "camera", gps = true, key = randomUUID(), challenge = null } = {},
) {
  const c =
    challenge ||
    (await call(owner, "post", `/tasks/${task.id}/capture`)).body.id;
  let r = call(owner, "post", `/tasks/${task.id}/evidence`)
    .field("kind", kind)
    .field("idempotencyKey", key)
    .field("captureId", c)
    .field("captureAt", new Date().toISOString())
    .field("source", source);
  if (gps)
    r = r
      .field("latitude", "27.56")
      .field("longitude", "76.62")
      .field("accuracy", "12")
      .field("gpsAt", new Date().toISOString());
  return r.attach(
    "photo",
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#448866" },
    })
      .jpeg()
      .toBuffer(),
    { filename: "camera.jpg", contentType: "image/jpeg" },
  );
}
it("enforces GPS and camera policy", async () => {
  expect((await photo("before", { gps: false })).status).toBe(400);
  expect((await photo("before", { source: "gallery" })).status).toBe(400);
});
it("uploads idempotently, retains metadata, and starts work", async () => {
  const key = randomUUID();
  const r = await photo("before", { key });
  expect(r.status, r.body.error).toBe(202);
  const duplicate = await photo("before", { key });
  expect(duplicate.body.id).toBe(r.body.id);
  await worker.drain(10);
  expect(
    (await db.evidence.findUnique({ where: { id: r.body.id } })).state,
  ).toBe("Ready");
  expect(
    (await call(other, "get", `/evidence/${r.body.id}/photo`)).status,
  ).toBe(403);
  expect(
    (await call(admin, "get", `/evidence/${r.body.id}/photo`)).status,
  ).toBe(200);
  expect((await call(owner, "post", `/tasks/${task.id}/start`)).status).toBe(
    200,
  );
});
it("requires completion photo and corrective action, then submits for FM approval", async () => {
  expect(
    (
      await call(owner, "post", `/tasks/${task.id}/submit`, {
        correctiveAction: "Replaced valve and verified flow",
      })
    ).status,
  ).toBe(400);
  const p = await photo("after");
  expect(p.status, p.body.error).toBe(202);
  await worker.drain(10);
  expect(
    (
      await call(owner, "post", `/tasks/${task.id}/submit`, {
        correctiveAction: "short",
      })
    ).status,
  ).toBe(400);
  const r = await call(owner, "post", `/tasks/${task.id}/submit`, {
    correctiveAction: "Replaced valve and verified flow",
  });
  expect(r.status, r.body.error).toBe(200);
  expect(r.body.status).toBe("AwaitingApproval");
  task = r.body;
  expect((await call(owner, "post", `/tasks/${task.id}/start`)).status).toBe(
    409,
  );
});
it("rejects stale reviews, records rejection, requires new-cycle photos", async () => {
  expect(
    (await call(admin, "post", `/tasks/${task.id}/approve`, { version: 1 }))
      .status,
  ).toBe(409);
  const r = await call(admin, "post", `/tasks/${task.id}/reject`, {
    version: task.version,
    reason: "Leak remains visible; replace seal",
  });
  expect(r.status).toBe(200);
  expect(r.body.cycle).toBe(2);
  expect(r.body.status).toBe("Open");
  expect((await call(owner, "post", `/tasks/${task.id}/start`)).status).toBe(
    400,
  );
  task = r.body;
  await photo("before");
  await worker.drain(10);
  await call(owner, "post", `/tasks/${task.id}/start`);
  await photo("after");
  await worker.drain(10);
  const sub = await call(owner, "post", `/tasks/${task.id}/submit`, {
    correctiveAction: "Replaced seal and pressure tested for five minutes",
  });
  expect(sub.status, sub.body.error).toBe(200);
  task = sub.body;
  const approve = await call(admin, "post", `/tasks/${task.id}/approve`, {
    version: task.version,
  });
  expect(approve.body.status).toBe("Completed");
  expect(await db.evidence.count({ where: { taskId: task.id } })).toBe(4);
});
it("stops reminders on approved tasks and prevents duplicate scheduled jobs", async () => {
  const before = await db.job.count({ where: { taskId: task.id } });
  await worker.sweep();
  await worker.sweep();
  expect(await db.job.count({ where: { taskId: task.id } })).toBe(before);
  expect(
    await db.job.count({ where: { key: { startsWith: "summary:" } } }),
  ).toBeLessThanOrEqual(1);
});
it("rejects expired OTP, enforces attempts, consumes valid OTP once", async () => {
  await db.otp.create({
    data: {
      email: other.email,
      digest: crypto.otpDigest(other.email, "123456"),
      expiresAt: new Date(Date.now() - 1),
    },
  });
  expect(
    (
      await call(null, "post", "/auth/verify", {
        email: other.email,
        otp: "123456",
      })
    ).status,
  ).toBe(400);
  await db.otp.update({
    where: { email: other.email },
    data: { expiresAt: new Date(Date.now() + 300000) },
  });
  for (let i = 0; i < 5; i++)
    expect(
      (
        await call(null, "post", "/auth/verify", {
          email: other.email,
          otp: "000000",
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await call(null, "post", "/auth/verify", {
        email: other.email,
        otp: "123456",
      })
    ).status,
  ).toBe(400);
  await db.otp.update({ where: { email: other.email }, data: { attempts: 0 } });
  const r = await call(null, "post", "/auth/verify", {
    email: other.email,
    otp: "123456",
  });
  expect(r.status).toBe(200);
  expect(r.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(
    (
      await call(null, "post", "/auth/verify", {
        email: other.email,
        otp: "123456",
      })
    ).status,
  ).toBe(400);
});
it("enforces cooldown, hides unknown accounts, revokes sessions on deactivation", async () => {
  await call(null, "post", "/auth/request", { email: owner.email });
  const first = await db.otp.findUnique({ where: { email: owner.email } });
  await call(null, "post", "/auth/request", { email: owner.email });
  expect(
    (await db.otp.findUnique({ where: { email: owner.email } })).digest,
  ).toBe(first.digest);
  expect(
    (
      await call(null, "post", "/auth/request", {
        email: "unknown@example.test",
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(admin, "patch", "/users/" + other.id, { active: false }))
      .status,
  ).toBe(200);
  expect((await call(other, "get", "/tasks")).status).toBe(401);
  expect(
    (await call(admin, "patch", "/users/" + admin.id, { active: false }))
      .status,
  ).toBe(409);
});

it("audit rows are append-only at the database layer", async () => {
  const a = await db.audit.findFirst();
  await expect(db.audit.delete({ where: { id: a.id } })).rejects.toThrow(
    "append-only",
  );
});
it("schedules an urgent overdue reminder once per window and escalates to FM", async () => {
  const source = await db.task.findUnique({ where: { id: task.id } });
  const { id, number, createdAt, updatedAt, ...base } = source;
  const t = await db.task.create({
    data: {
      ...base,
      title: "Scheduler test",
      status: "InProgress",
      deadline: new Date(Date.now() - 7200000),
      nextReminderAt: new Date(Date.now() - 1000),
      nextEscalationAt: new Date(Date.now() - 1000),
    },
  });
  await worker.sweep();
  const n = await db.job.count({ where: { taskId: t.id } });
  expect(n).toBe(2);
  await worker.sweep();
  expect(await db.job.count({ where: { taskId: t.id } })).toBe(n);
  const updated = await db.task.findUnique({ where: { id: t.id } });
  expect(updated.nextReminderAt.getTime() - Date.now()).toBeGreaterThan(
    10700000,
  );
  const cancel = await call(admin, "post", `/tasks/${t.id}/cancel`, {
    version: t.version,
    reason: "Scheduler test resolved by cancellation",
  });
  expect(cancel.status).toBe(200);
  await worker.drain(30);
  expect(
    await db.job.count({ where: { taskId: t.id, state: "Skipped" } }),
  ).toBe(2);
});
it("marks interrupted email sends uncertain and retries expired pre-send leases", async () => {
  const a = await db.job.create({
    data: {
      key: randomUUID(),
      type: "mail",
      payload: { recipient: owner.email },
      state: "Sending",
      leaseUntil: new Date(Date.now() - 1),
    },
  });
  const b = await db.job.create({
    data: {
      key: randomUUID(),
      type: "mail",
      payload: { recipient: owner.email },
      state: "Processing",
      leaseUntil: new Date(Date.now() - 1),
    },
  });
  await worker.sweep();
  expect((await db.job.findUnique({ where: { id: a.id } })).state).toBe(
    "Uncertain",
  );
  expect((await db.job.findUnique({ where: { id: b.id } })).state).toBe(
    "Pending",
  );
});
