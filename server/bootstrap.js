import { z } from "zod";
import { db, serial, audit } from "./db.js";
const email = z
  .string()
  .email()
  .parse(process.env.BOOTSTRAP_EMAIL)
  .toLowerCase();
const name = z.string().min(2).parse(process.env.BOOTSTRAP_NAME);
try {
  await serial(async (tx) => {
    if (await tx.user.count({ where: { role: "FM" } }))
      throw new Error(
        "FM already exists; use the authenticated user management page",
      );
    const u = await tx.user.create({ data: { email, name, role: "FM" } });
    await tx.settings.upsert({
      where: { id: "global" },
      create: {},
      update: {},
    });
    await audit(tx, u.id, "FM_BOOTSTRAPPED");
  });
  console.log("First FM provisioned. Sign in using email OTP.");
} finally {
  await db.$disconnect();
}
