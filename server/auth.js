import { randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, serial, audit, enqueue } from "./db.js";
import { config } from "./config.js";
import { hash, token, otpDigest, seal } from "./crypto.js";
import { ensure } from "./domain.js";
const cookieName =
  config.NODE_ENV === "production" ? "__Host-fo_session" : "fo_session";
const cookieOpts = {
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
};
export async function limit(key, max, seconds) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const row = await db.rateBucket.upsert({
    where: { key: `${key}:${window}` },
    create: {
      key: `${key}:${window}`,
      expiresAt: new Date(Date.now() + seconds * 2000),
    },
    update: { count: { increment: 1 } },
  });
  ensure(row.count <= max, 429, "Too many requests. Please try again later.");
}
export async function auth(req, res, next) {
  const value = req.cookies[cookieName];
  ensure(value, 401, "Please sign in");
  const s = await db.session.findUnique({
    where: { id: hash(value) },
    include: { user: true },
  });
  ensure(
    s && s.expiresAt > new Date() && s.user.active,
    401,
    "Session expired or account inactive",
  );
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    ensure(req.headers["x-csrf-token"] === s.csrf, 403, "Invalid CSRF token");
  req.user = s.user;
  req.session = s;
  next();
}
export function installAuth(app) {
  app.post("/api/auth/request", async (req, res) => {
    const email = z
      .string()
      .email()
      .max(254)
      .transform((x) => x.toLowerCase().trim())
      .parse(req.body.email);
    await limit(`otp-ip:${req.ip}`, 15, 900);
    await limit(`otp-email:${hash(email)}`, 5, 900);
    await serial(async (tx) => {
      const old = await tx.otp.findUnique({ where: { email } });
      if (old && Date.now() - old.sentAt.getTime() < 60000) return;
      const u = await tx.user.findUnique({ where: { email } });
      if (!u?.active) {
        await audit(tx, null, "OTP_UNRECOGNIZED", null, {
          emailHash: hash(email),
        });
        return;
      }
      const otp = String(randomInt(1000000)).padStart(6, "0"),
        expiresAt = new Date(Date.now() + 300000);
      await tx.otp.upsert({
        where: { email },
        create: { email, digest: otpDigest(email, otp), expiresAt },
        update: {
          digest: otpDigest(email, otp),
          expiresAt,
          sentAt: new Date(),
          attempts: 0,
        },
      });
      await enqueue(tx, `otp:${u.id}:${token()}`, "mail", {
        recipient: email,
        subject: "FacilityOps sign-in code",
        sealed: seal(
          `Your sign-in code is ${otp}. It expires in 5 minutes. Do not share it.`,
        ),
        expiresAt: expiresAt.toISOString(),
      });
      await audit(tx, u.id, "OTP_REQUESTED");
    });
    res.json({
      message: "If your account is active, a code will arrive shortly.",
      cooldown: 60,
    });
  });
  app.post("/api/auth/verify", async (req, res) => {
    const { email, otp } = z
      .object({
        email: z
          .string()
          .email()
          .transform((x) => x.toLowerCase().trim()),
        otp: z.string().regex(/^\d{6}$/),
      })
      .parse(req.body);
    await limit(`verify:${req.ip}`, 30, 900);
    const result = await serial(async (tx) => {
      const o = await tx.otp.findUnique({ where: { email } }),
        u = await tx.user.findUnique({ where: { email } });
      if (!o || !u?.active || o.expiresAt <= new Date() || o.attempts >= 5) {
        await audit(tx, u?.id, "OTP_DENIED");
        return null;
      }
      await tx.otp.update({
        where: { email },
        data: { attempts: { increment: 1 } },
      });
      if (
        !timingSafeEqual(
          Buffer.from(o.digest),
          Buffer.from(otpDigest(email, otp)),
        )
      ) {
        await audit(tx, u.id, "OTP_INVALID");
        return null;
      }
      await tx.otp.delete({ where: { email } });
      const raw = token();
      const session = await tx.session.create({
        data: {
          id: hash(raw),
          csrf: token(),
          userId: u.id,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      await audit(tx, u.id, "LOGIN");
      return { raw, session };
    });
    ensure(result, 400, "Invalid or expired code");
    if (req.cookies[cookieName])
      await db.session.deleteMany({
        where: { id: hash(req.cookies[cookieName]) },
      });
    res
      .cookie(cookieName, result.raw, { ...cookieOpts, maxAge: 8 * 3600000 })
      .json({ ok: true });
  });
  app.get("/api/me", auth, (req, res) =>
    res.json({
      user: req.user,
      csrf: req.session.csrf,
      mode: config.INTEGRATION_MODE,
    }),
  );
  app.post("/api/auth/logout", auth, async (req, res) => {
    await db.session.delete({ where: { id: req.session.id } });
    await audit(db, req.user.id, "LOGOUT");
    res.clearCookie(cookieName, cookieOpts).json({ ok: true });
  });
}
