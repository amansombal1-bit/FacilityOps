import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { db } from "./db.js";
import { ensure } from "./domain.js";
import { auth, installAuth } from "./auth.js";
import { installTasks } from "./tasks.js";
import { installAdmin } from "./admin.js";
export const app = express();
app.disable("x-powered-by");
// Cloud Run is the sole trusted reverse proxy. Do not expose this service behind untrusted proxies.
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "blob:", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  pinoHttp({
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "req.headers.x-csrf-token",
      "res.headers.set-cookie",
    ],
    serializers: {
      req: (r) => ({ id: r.id, method: r.method, url: r.url?.split("?")[0] }),
      res: (r) => ({ statusCode: r.statusCode }),
    },
  }),
);
app.get("/health/live", (req, res) => res.json({ ok: true }));
app.get("/health/ready", async (req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    ensure(
      req.headers.origin === config.APP_ORIGIN,
      403,
      "Request origin rejected",
    );
  next();
});
installAuth(app);
app.use("/api", auth);
installTasks(app);
installAdmin(app);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
app.use(express.static(fileURLToPath(new URL("../dist/", import.meta.url))));
app.get("/{*path}", (req, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err.name === "ZodError"
      ? 400
      : err.code === "P2002"
        ? 409
        : err.code === "LIMIT_FILE_SIZE"
          ? 413
          : err.status || 500;
  req.log.error({ status, code: err.code }, "Request failed");
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "Unexpected server error"
          : err.name === "ZodError"
            ? "Invalid request fields"
            : err.code === "P2002"
              ? "Record already exists"
              : err.code === "LIMIT_FILE_SIZE"
                ? "Photo exceeds 10 MB"
                : err.message,
    });
});
