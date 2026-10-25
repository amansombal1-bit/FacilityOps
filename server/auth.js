import { timingSafeEqual } from "node:crypto";
import { scrypt as scryptCallback, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { db, serial, audit } from "./db.js";
import { config } from "./config.js";
import { hash, token } from "./crypto.js";
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
const scrypt = promisify(scryptCallback);
export async function passwordDigest(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256)
    throw Object.assign(new Error("Use a password of 12–256 characters"), {status: 400});
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  if (!stored) {
    await scrypt(password, Buffer.alloc(16), 64);
    return false;
  }
  const [algorithm, salt, digest] = stored.split(":");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(digest)) return false;
  const actual = await scrypt(password, Buffer.from(salt, "hex"), 64);
  return timingSafeEqual(actual, Buffer.from(digest, "hex"));
}
export function installAuth(app) {
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = z.object({
      email: z.string().email().max(254).transform(x => x.toLowerCase().trim()),
      password: z.string().min(1).max(256)
    }).parse(req.body);
    await limit(`password-ip:${req.ip}`, 15, 900);
    await limit(`password-email:${hash(email)}`, 8, 900);
    const user = await db.user.findUnique({ where: { email } });
    // Do not reveal whether an account exists or is active.
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user?.active || !ok) {
      await audit(db, user?.id || null, "LOGIN_DENIED");
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const raw = token();
    await serial(async tx => {
      await tx.session.create({ data: {
        id: hash(raw), csrf: token(), userId: user.id,
        expiresAt: new Date(Date.now() + 8 * 3600000)
      }});
      await audit(tx, user.id, "LOGIN");
    });
    res.cookie(cookieName, raw, { ...cookieOpts, maxAge: 8 * 3600000 }).json({ ok: true });
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
