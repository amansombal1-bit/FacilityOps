import {
  createHash,
  createHmac,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { config } from "./config.js";
export const token = () => randomBytes(32).toString("base64url");
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const otpDigest = (email, otp) =>
  createHmac("sha256", config.OTP_SECRET)
    .update(email + ":" + otp)
    .digest("hex");
const key = createHash("sha256").update(config.JOB_SECRET).digest();
export function seal(s) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  const b = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), b]).toString("base64");
}
export function unseal(s) {
  const b = Buffer.from(s, "base64"),
    d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
