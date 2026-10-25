import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import pino from "pino";
import { db, serial, audit, enqueue } from "./db.js";
import { config } from "./config.js";
import { unseal } from "./crypto.js";
import { interval, quietAdjusted, unresolved, taskText } from "./domain.js";
import { sendMail, uploadEvidence } from "./integrations.js";
const log = pino();
export async function sweep(now = new Date()) {
  await serial(async (tx) => {
    const locked =
      await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(814207) AS locked`;
    if (!locked[0].locked) return;
    const settings = await tx.settings.upsert({
      where: { id: "global" },
      create: {},
      update: {},
    });
    const tasks = await tx.task.findMany({
      where: { status: { in: unresolved } },
      include: { assignedTo: true },
    });
    const admins = await tx.user.findMany({
      where: { role: "FM", active: true },
    });
    for (const t of tasks) {
      if (t.nextReminderAt <= now) {
        const runAt = quietAdjusted(now, settings);
        const recipient =
          t.status === "AwaitingApproval"
            ? admins
            : [t.assignedTo].filter((u) => u.active);
        for (const u of recipient)
          await enqueue(
            tx,
            `reminder:${t.id}:${t.nextReminderAt.toISOString()}:${u.id}`,
            "mail",
            { recipient: u.email, event: "reminder", taskVersion: t.version },
            t.id,
            runAt,
          );
        await tx.task.update({
          where: { id: t.id },
          data: {
            nextReminderAt: new Date(runAt.getTime() + interval(t.priority)),
          },
        });
        await audit(tx, null, "REMINDER_QUEUED", t.id);
      }
      if (t.deadline < now && t.nextEscalationAt <= now) {
        for (const u of admins)
          await enqueue(
            tx,
            `escalation:${t.id}:${t.nextEscalationAt.toISOString()}:${u.id}`,
            "mail",
            { recipient: u.email, event: "escalation", taskVersion: t.version },
            t.id,
            quietAdjusted(now, settings),
          );
        await tx.task.update({
          where: { id: t.id },
          data: {
            nextEscalationAt: new Date(
              now.getTime() + settings.escalationHours * 3600000,
            ),
          },
        });
        await audit(tx, null, "ESCALATION_QUEUED", t.id);
      }
    }
    const local = DateTime.fromJSDate(now).setZone("Asia/Kolkata");
    if (local.hour >= settings.dailySummaryHour) {
      const text =
        `Daily operations summary · ${local.toISODate()} IST\nPending: ${tasks.length}\nOverdue: ${tasks.filter((t) => t.deadline < now).length}\nAwaiting FM approval: ${tasks.filter((t) => t.status === "AwaitingApproval").length}\n\n` +
        tasks.slice(0, 200).map(taskText).join("\n\n");
      for (const u of admins)
        await enqueue(
          tx,
          `summary:${local.toISODate()}:${u.id}`,
          "mail",
          {
            recipient: u.email,
            subject: "FacilityOps daily pending and overdue report",
            body: text,
          },
          null,
          quietAdjusted(now, settings),
        );
    }
    // Mail calls with an ambiguous outcome are never retried automatically.
    await tx.job.updateMany({
      where: { state: "Sending", leaseUntil: { lt: now } },
      data: {
        state: "Uncertain",
        error:
          "Worker interrupted during provider call; reconcile before retry",
      },
    });
    await tx.job.updateMany({
      where: { state: "Processing", leaseUntil: { lt: now } },
      data: { state: "Pending", leaseToken: null },
    });
    await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
    await tx.otp.deleteMany({ where: { expiresAt: { lt: now } } });
    await tx.rateBucket.deleteMany({ where: { expiresAt: { lt: now } } });
    await tx.capture.deleteMany({ where: { expiresAt: { lt: now } } });
  });
}
async function claim() {
  return db.$transaction(async (tx) => {
    const rows =
      await tx.$queryRaw`SELECT id FROM "Job" WHERE state = 'Pending' AND "runAt" <= NOW() ORDER BY CASE WHEN payload ? 'sealed' THEN 0 ELSE 1 END, "runAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    return tx.job.update({
      where: { id: rows[0].id },
      data: {
        state: "Processing",
        leaseToken: randomUUID(),
        leaseUntil: new Date(Date.now() + 600000),
        attempts: { increment: 1 },
      },
    });
  });
}
export async function drain(max = 50) {
  let count = 0;
  while (count++ < max) {
    const job = await claim();
    if (!job) break;
    try {
      if (job.type === "upload") {
        const e = await db.evidence.findUnique({
          where: { id: job.payload.evidenceId },
          include: { task: true },
        });
        if (e.state !== "Ready") {
          const id = await uploadEvidence(e, e.task);
          await db.$transaction(async (tx) => {
            await tx.evidence.update({
              where: { id: e.id },
              data: { state: "Ready", driveId: id, bytes: null, error: null },
            });
            await audit(tx, null, "EVIDENCE_STORED", e.taskId, {
              evidenceId: e.id,
            });
          });
        }
      } else if (job.type === "mail") {
        const p = job.payload;
        const user = await db.user.findUnique({
          where: { email: p.recipient },
        });
        let skip =
          !user?.active || (p.expiresAt && new Date(p.expiresAt) <= new Date());
        let body = p.sealed ? unseal(p.sealed) : p.body,
          subject = p.subject;
        if (job.taskId) {
          const t = await db.task.findUnique({
            where: { id: job.taskId },
            include: { assignedTo: true },
          });
          skip ||=
            !t ||
            ([
              "reminder",
              "escalation",
              "assigned",
              "submitted",
              "rejected",
            ].includes(p.event) &&
              (!unresolved.includes(t.status) || p.taskVersion !== t.version));
          if (t) {
            body = `${p.event.toUpperCase()}\n${taskText(t)}\n${t.rejectionReason ? `Rework reason: ${t.rejectionReason}\n` : ""}\nOpen securely: ${config.APP_ORIGIN}/?task=${t.id}\nOnly FM approval closes a task.`;
            subject = `FacilityOps ${p.event}: FO-${t.number} ${t.title}`;
          }
        }
        if (skip) {
          await db.job.update({
            where: { id: job.id },
            data: {
              state: "Skipped",
              payload: { recipient: p.recipient, event: p.event || "expired" },
            },
          });
          continue;
        }
        await db.job.update({
          where: { id: job.id },
          data: { state: "Sending" },
        });
        const attempt = await db.emailAttempt.create({
          data: { jobId: job.id, recipient: p.recipient, result: "Started" },
        });
        try {
          const providerId = await sendMail(p.recipient, subject, body, job.id);
          await db.emailAttempt.update({
            where: { id: attempt.id },
            data: {
              result:
                config.INTEGRATION_MODE === "local" ? "LocalOnly" : "Accepted",
              providerId,
            },
          });
        } catch (e) {
          const status = e.response?.status;
          const safeRetry = [429, 503].includes(status);
          await db.emailAttempt.update({
            where: { id: attempt.id },
            data: {
              result: safeRetry ? "Rejected" : "Uncertain",
              error: `Provider status ${status || "unknown"}`,
            },
          });
          e.uncertain = !safeRetry;
          throw e;
        }
        await audit(db, null, "EMAIL_ACCEPTED", job.taskId, {
          jobId: job.id,
          event: p.event || "message",
          localOnly: config.INTEGRATION_MODE === "local",
        });
      }
      await db.job.update({
        where: { id: job.id },
        data: {
          state: "Done",
          leaseUntil: null,
          leaseToken: null,
          payload: job.payload.sealed
            ? { recipient: job.payload.recipient, event: "otp-redacted" }
            : job.payload,
        },
      });
    } catch (e) {
      const latest = await db.job.findUnique({
        where: { id: job.id },
        select: { state: true },
      });
      const uncertain =
        e.uncertain ?? (job.type === "mail" && latest?.state === "Sending");
      const terminal = job.attempts >= 5;
      const state = uncertain ? "Uncertain" : terminal ? "Failed" : "Pending";
      await db.job.update({
        where: { id: job.id },
        data: {
          state,
          error:
            "Integration operation failed; inspect provider status and worker logs",
          runAt: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
          ),
          leaseUntil: null,
        },
      });
      if (job.type === "upload")
        await db.evidence.update({
          where: { id: job.payload.evidenceId },
          data: {
            state: terminal ? "Failed" : "Pending",
            error: "Drive upload failed; retry scheduled or FM review needed",
          },
        });
      log.error(
        { jobId: job.id, state, code: e.code },
        "Background job failed",
      );
    }
  }
}
export async function run() {
  await sweep();
  await drain(100);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await run();
  } catch (e) {
    log.error({ code: e.code, message: e.message }, "Worker failed");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
