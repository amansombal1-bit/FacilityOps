import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import { db, serial, audit, enqueue } from "./db.js";
import {
  ensure,
  owner,
  fm,
  editable,
  interval,
  validateSubmission,
  csvCell,
} from "./domain.js";
import { hash } from "./crypto.js";
import { notify } from "./notifications.js";
import { downloadEvidence } from "./integrations.js";
import { limit } from "./auth.js";
const fields = {
  title: z.string().trim().min(3).max(180),
  description: z.string().max(5000),
  category: z.string().trim().min(1).max(80),
  floor: z.string().trim().min(1).max(60),
  room: z.string().max(60).default(""),
  assignedToId: z.string().uuid(),
  priority: z.enum(["Normal", "Urgent", "Critical"]),
  deadline: z.string().datetime(),
  beforeRequired: z.boolean(),
  gpsRequired: z.boolean(),
  cameraRequired: z.boolean(),
};
const taskSchema = z.object(fields).strict();
const withOwner = {
  assignedTo: { select: { id: true, name: true, email: true, active: true } },
  createdBy: { select: { id: true, name: true } },
};
export const safeEvidence = {
  id: true,
  taskId: true,
  userId: true,
  cycle: true,
  kind: true,
  state: true,
  error: true,
  captureAt: true,
  receivedAt: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  gpsAt: true,
  source: true,
  size: true,
  sha256: true,
};
export async function getTask(tx, id) {
  const t = await tx.task.findUnique({ where: { id }, include: withOwner });
  ensure(t, 404, "Task not found");
  return t;
}
function filters(q) {
  const where = {};
  for (const k of ["floor", "category", "assignedToId"])
    if (q[k]) where[k] = String(q[k]);
  if (q.status)
    where.status = z
      .enum([
        "Open",
        "InProgress",
        "AwaitingApproval",
        "Completed",
        "Cancelled",
      ])
      .parse(q.status);
  if (q.priority)
    where.priority = z.enum(["Normal", "Urgent", "Critical"]).parse(q.priority);
  if (q.from || q.to)
    where.createdAt = {
      ...(q.from ? { gte: new Date(z.string().datetime().parse(q.from)) } : {}),
      ...(q.to ? { lte: new Date(z.string().datetime().parse(q.to)) } : {}),
    };
  if (q.overdue === "true") {
    where.deadline = { lt: new Date() };
    where.status = { in: ["Open", "InProgress", "AwaitingApproval"] };
  }
  return where;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12, fieldSize: 2000 },
});
export function installTasks(app) {
  app.get("/api/tasks", async (req, res) => {
    const where = filters(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const [items, total] = await Promise.all([
      db.task.findMany({
        where,
        include: withOwner,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 50,
        take: 50,
      }),
      db.task.count({ where }),
    ]);
    res.json({ items, total, page });
  });
  app.get("/api/tasks.csv", async (req, res) => {
    fm(req.user);
    const list = await db.task.findMany({
      where: filters(req.query),
      include: withOwner,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    res
      .set("Content-Type", "text/csv")
      .attachment("facilityops-tasks.csv")
      .send(
        [
          "ID,Title,Floor,Room,Category,Owner,Priority,Status,Deadline,Corrective action",
          ...list.map((t) =>
            [
              t.number,
              t.title,
              t.floor,
              t.room,
              t.category,
              t.assignedTo.name,
              t.priority,
              t.status,
              t.deadline.toISOString(),
              t.correctiveAction,
            ]
              .map(csvCell)
              .join(","),
          ),
        ].join("\r\n"),
      );
  });
  app.post("/api/tasks", async (req, res) => {
    fm(req.user);
    const d = taskSchema.parse(req.body);
    ensure(
      new Date(d.deadline) > new Date(),
      400,
      "Deadline must be in the future",
    );
    const t = await serial(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: d.assignedToId } });
      ensure(u?.active && (u.role === "FOT" || (u.role === "FM" && u.id === req.user.id)), 400, "Choose an active FOT or yourself");
      const settings = await tx.settings.findUnique({
        where: { id: "global" },
      });
      const t = await tx.task.create({
        data: {
          ...d,
          deadline: new Date(d.deadline),
          createdById: req.user.id,
          nextReminderAt: new Date(Date.now() + interval(d.priority)),
          nextEscalationAt: new Date(
            new Date(d.deadline).getTime() +
              (settings?.escalationHours || 6) * 3600000,
          ),
        },
        include: withOwner,
      });
      await audit(tx, req.user.id, "TASK_CREATED", t.id, d);
      await notify(tx, t, "assigned");
      return t;
    });
    res.status(201).json(t);
  });
  app.get("/api/tasks/:id", async (req, res) => {
    const t = await getTask(db, req.params.id);
    res.json({
      ...t,
      evidence: await db.evidence.findMany({
        where: { taskId: t.id },
        select: safeEvidence,
        orderBy: { receivedAt: "asc" },
      }),
      history: await db.audit.findMany({
        where: { taskId: t.id },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    });
  });
  app.patch("/api/tasks/:id", async (req, res) => {
    fm(req.user);
    const { version, ...d } = taskSchema
      .partial()
      .extend({ version: z.number().int() })
      .parse(req.body);
    const t = await serial(async (tx) => {
      const old = await getTask(tx, req.params.id);
      ensure(
        editable.includes(old.status),
        409,
        "Only open or in-progress tasks can be edited",
      );
      ensure(old.version === version, 409, "Task changed. Refresh and retry.");
      if (d.assignedToId) {
        const u = await tx.user.findUnique({ where: { id: d.assignedToId } });
        ensure(u?.active && u.role === "FOT", 400, "Choose an active FOT");
      }
      const reset =
        (d.assignedToId && d.assignedToId !== old.assignedToId) ||
        (d.beforeRequired !== undefined &&
          d.beforeRequired !== old.beforeRequired) ||
        (d.gpsRequired !== undefined && d.gpsRequired !== old.gpsRequired) ||
        (d.cameraRequired !== undefined &&
          d.cameraRequired !== old.cameraRequired);
      const settings = await tx.settings.findUnique({
        where: { id: "global" },
      });
      const t = await tx.task.update({
        where: { id: old.id },
        data: {
          ...d,
          ...(d.deadline
            ? {
                deadline: new Date(d.deadline),
                nextEscalationAt: new Date(
                  new Date(d.deadline).getTime() +
                    settings.escalationHours * 3600000,
                ),
              }
            : {}),
          version: { increment: 1 },
          ...(reset
            ? {
                cycle: { increment: 1 },
                status: "Open",
                correctiveAction: "",
                resolutionNotes: "",
              }
            : {}),
          nextReminderAt: new Date(
            Date.now() + interval(d.priority || old.priority),
          ),
        },
        include: withOwner,
      });
      await audit(tx, req.user.id, "TASK_EDITED", t.id, {
        changes: d,
        resetEvidenceCycle: !!reset,
      });
      await notify(tx, t, "assigned");
      return t;
    });
    res.json(t);
  });
  app.post("/api/tasks/:id/start", async (req, res) => {
    res.json(
      await serial(async (tx) => {
        const t = await getTask(tx, req.params.id);
        owner(req.user, t);
        ensure(t.status === "Open", 409, "Task is not open");
        if (t.beforeRequired)
          ensure(
            await tx.evidence.count({
              where: {
                taskId: t.id,
                cycle: t.cycle,
                kind: "before",
                state: "Ready",
                userId: req.user.id,
              },
            }),
            400,
            "Upload before photo before starting work",
          );
        const updated = await tx.task.update({
          where: { id: t.id },
          data: { status: "InProgress", version: { increment: 1 } },
        });
        await audit(tx, req.user.id, "TASK_STARTED", t.id);
        return updated;
      }),
    );
  });
  app.post("/api/tasks/:id/capture", async (req, res) => {
    const t = await getTask(db, req.params.id);
    owner(req.user, t);
    ensure(editable.includes(t.status), 409, "Task is not editable");
    await limit(`capture:${req.user.id}`, 60, 3600);
    res.json(
      await db.capture.create({
        data: {
          taskId: t.id,
          userId: req.user.id,
          cycle: t.cycle,
          expiresAt: new Date(Date.now() + 600000),
        },
      }),
    );
  });
  app.post(
    "/api/tasks/:id/evidence",
    upload.single("photo"),
    async (req, res) => {
      await limit(`upload:${req.user.id}`, 60, 3600);
      const meta = z
        .object({
          kind: z.enum(["before", "after"]),
          idempotencyKey: z.string().uuid(),
          captureId: z.string().uuid().optional(),
          captureAt: z.string().datetime(),
          source: z.enum(["camera", "gallery"]),
          latitude: z.coerce.number().min(-90).max(90).optional(),
          longitude: z.coerce.number().min(-180).max(180).optional(),
          accuracy: z.coerce.number().min(0).max(100000).optional(),
          gpsAt: z.string().datetime().optional(),
        })
        .parse(req.body);
      ensure(
        req.file &&
          ["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype),
        400,
        "Use a JPEG, PNG or WebP image, at most 10 MB",
      );
      let bytes;
      try {
        const s = sharp(req.file.buffer, { limitInputPixels: 25000000 });
        const m = await s.metadata();
        ensure(
          ["jpeg", "png", "webp"].includes(m.format) && !m.pages,
          400,
          "Unsupported image",
        );
        bytes = await s
          .rotate()
          .resize({
            width: 1280,
            height: 1280,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 75 })
          .toBuffer();
      } catch {
        ensure(false, 400, "Invalid image or excessive image dimensions");
      }
      const e = await serial(async (tx) => {
        const t = await getTask(tx, req.params.id);
        owner(req.user, t);
        const previous = await tx.evidence.findUnique({
          where: { idempotencyKey: meta.idempotencyKey },
        });
        if (previous) {
          ensure(
            previous.taskId === t.id &&
              previous.userId === req.user.id &&
              previous.sha256 === hash(bytes),
            409,
            "Upload key already used",
          );
          return tx.evidence.findUnique({
            where: { id: previous.id },
            select: safeEvidence,
          });
        }
        ensure(editable.includes(t.status), 409, "Task is not editable");
        if (meta.kind === "before")
          ensure(
            t.status === "Open",
            409,
            "Before photo must precede starting work",
          );
        if (meta.kind === "after")
          ensure(
            t.status === "InProgress",
            409,
            "Start task before completion photo",
          );
        const captureAt = new Date(meta.captureAt);
        ensure(
          captureAt.getTime() <= Date.now() + 30000 &&
            captureAt.getTime() > Date.now() - 600000,
          400,
          "Capture expired. Capture a new photo.",
        );
        if (t.cameraRequired)
          ensure(
            meta.source === "camera" && meta.captureId,
            400,
            "Fresh in-app camera capture required",
          );
        if (meta.source === "camera") {
          const c =
            meta.captureId &&
            (await tx.capture.findUnique({ where: { id: meta.captureId } }));
          ensure(
            c &&
              !c.used &&
              c.taskId === t.id &&
              c.userId === req.user.id &&
              c.cycle === t.cycle &&
              c.expiresAt > new Date(),
            400,
            "Capture challenge expired or already used",
          );
          await tx.capture.update({
            where: { id: c.id },
            data: { used: true },
          });
        }
        if (t.gpsRequired)
          ensure(
            meta.latitude != null &&
              meta.longitude != null &&
              meta.accuracy != null &&
              meta.gpsAt,
            400,
            "Location permission and current GPS fix required",
          );
        if (meta.gpsAt)
          ensure(
            Math.abs(new Date(meta.gpsAt).getTime() - captureAt.getTime()) <
              120000,
            400,
            "Location fix must be within two minutes of photo",
          );
        const e = await tx.evidence.create({
          data: {
            taskId: t.id,
            userId: req.user.id,
            cycle: t.cycle,
            kind: meta.kind,
            idempotencyKey: meta.idempotencyKey,
            sha256: hash(bytes),
            bytes,
            size: bytes.length,
            captureAt,
            source: meta.source,
            latitude: meta.latitude,
            longitude: meta.longitude,
            accuracy: meta.accuracy,
            gpsAt: meta.gpsAt ? new Date(meta.gpsAt) : undefined,
          },
        });
        await enqueue(
          tx,
          `upload:${e.id}`,
          "upload",
          { evidenceId: e.id },
          t.id,
        );
        await audit(tx, req.user.id, "EVIDENCE_RECEIVED", t.id, {
          evidenceId: e.id,
          kind: e.kind,
          cycle: e.cycle,
        });
        return tx.evidence.findUnique({
          where: { id: e.id },
          select: safeEvidence,
        });
      });
      res.status(202).json(e);
      // Opportunistic processing starts as soon as the upload is accepted.
      // Scheduled worker remains necessary for reliable retries after restarts.
      setImmediate(async () => {
        try {
          const { drain } = await import("./worker.js");
          await drain(5);
        } catch (err) {
          req.log.error({ code: err.code, message: err.message }, "Immediate photo processing failed");
        }
      });
    },
  );
  app.get("/api/evidence/:id/photo", async (req, res) => {
    const e = await db.evidence.findUnique({ where: { id: req.params.id } });
    ensure(e, 404, "Evidence not found");
    ensure(
      req.user.role === "FM" || e.userId === req.user.id,
      403,
      "Evidence restricted to FM and submitting owner",
    );
    ensure(e.state === "Ready", 409, "Photo is not available yet");
    res
      .set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(await downloadEvidence(e));
  });
  app.post("/api/evidence/:id/retry", async (req, res) => {
    await serial(async (tx) => {
      const e = await tx.evidence.findUnique({ where: { id: req.params.id } });
      ensure(e, 404, "Evidence not found");
      ensure(
        req.user.role === "FM" || e.userId === req.user.id,
        403,
        "Forbidden",
      );
      ensure(e.state === "Failed" && e.bytes, 409, "Evidence is not retryable");
      await tx.evidence.update({
        where: { id: e.id },
        data: { state: "Pending", error: null },
      });
      await tx.job.update({
        where: { key: `upload:${e.id}` },
        data: { state: "Pending", attempts: 0, runAt: new Date(), error: null },
      });
      await audit(tx, req.user.id, "UPLOAD_RETRIED", e.taskId, {
        evidenceId: e.id,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/tasks/:id/submit", async (req, res) => {
    const d = z
      .object({
        correctiveAction: z.string().trim().min(10).max(5000),
        resolutionNotes: z.string().max(5000).default(""),
      })
      .parse(req.body);
    res.json(
      await serial(async (tx) => {
        const t = await getTask(tx, req.params.id);
        owner(req.user, t);
        ensure(t.status === "InProgress", 409, "Start task before submission");
        validateSubmission(
          t,
          await tx.evidence.findMany({
            where: { taskId: t.id, cycle: t.cycle },
          }),
          d.correctiveAction,
        );
        const updated = await tx.task.update({
          where: { id: t.id },
          data: { ...d, status: "AwaitingApproval", version: { increment: 1 } },
          include: withOwner,
        });
        await audit(tx, req.user.id, "SUBMITTED", t.id, {
          ...d,
          cycle: t.cycle,
        });
        await notify(tx, updated, "submitted");
        return updated;
      }),
    );
  });
  for (const action of ["approve", "reject", "cancel"])
    app.post(`/api/tasks/:id/${action}`, async (req, res) => {
      fm(req.user);
      const d = z
        .object({
          version: z.number().int(),
          reason: z.string().trim().max(3000).default(""),
        })
        .parse(req.body);
      res.json(
        await serial(async (tx) => {
          const t = await getTask(tx, req.params.id);
          ensure(
            t.version === d.version,
            409,
            "Task changed; refresh before reviewing",
          );
          ensure(
            action === "cancel"
              ? !["Completed", "Cancelled"].includes(t.status)
              : t.status === "AwaitingApproval",
            409,
            "Invalid task state",
          );
          if (action !== "approve")
            ensure(d.reason.length >= 5, 400, "A reason is required");
          const updated = await tx.task.update({
            where: { id: t.id },
            data: {
              version: { increment: 1 },
              ...(action === "approve"
                ? {
                    status: "Completed",
                    approvedById: req.user.id,
                    approvedAt: new Date(),
                  }
                : action === "cancel"
                  ? { status: "Cancelled" }
                  : {
                      status: "Open",
                      rejectionReason: d.reason,
                      cycle: { increment: 1 },
                      nextReminderAt: new Date(),
                      nextEscalationAt: new Date(),
                      correctiveAction: "",
                      resolutionNotes: "",
                    }),
            },
            include: withOwner,
          });
          await audit(tx, req.user.id, action.toUpperCase(), t.id, {
            reason: d.reason,
            cycle: t.cycle,
          });
          await notify(
            tx,
            updated,
            action === "approve"
              ? "approved"
              : action === "reject"
                ? "rejected"
                : "cancelled",
          );
          return updated;
        }),
      );
    });
}
