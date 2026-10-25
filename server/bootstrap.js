import { z } from "zod";
import { db, serial, audit } from "./db.js";
import { passwordDigest } from "./auth.js";
const email = z
  .string()
  .email()
  .parse(process.env.BOOTSTRAP_EMAIL)
  .toLowerCase();
const name = z.string().min(2).parse(process.env.BOOTSTRAP_NAME);
const password = z.string().min(12).max(256).parse(process.env.BOOTSTRAP_PASSWORD);
try {
  const passwordHash = await passwordDigest(password);
  await serial(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== "FM" || !existing.active || existing.passwordHash)
        throw new Error("Existing admin cannot be changed by bootstrap");
      await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: existing.id } });
      await audit(tx, existing.id, "FM_PASSWORD_INITIALIZED");
      return;
    }
    if (await tx.user.count({ where: { role: "FM" } }))
      throw new Error("Another FM already exists; use authenticated user management");
    const u = await tx.user.create({ data: { email, name, role: "FM", passwordHash } });
    await tx.settings.upsert({
      where: { id: "global" },
      create: {},
      update: {},
    });
    await audit(tx, u.id, "FM_BOOTSTRAPPED");
  });
  console.log("FM password initialized. Sign in with email and password.");
} finally {
  await db.$disconnect();
}
