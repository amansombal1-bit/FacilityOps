import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
export async function audit(tx, actorId, action, taskId = null, details = {}) {
  return tx.audit.create({ data: { actorId, action, taskId, details } });
}
export async function enqueue(
  tx,
  key,
  type,
  payload,
  taskId = null,
  runAt = new Date(),
) {
  return tx.job.upsert({
    where: { key },
    create: { key, type, payload, taskId, runAt },
    update: {},
  });
}
export async function serial(fn) {
  for (let n = 0; n < 5; n++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 20000,
      });
    } catch (e) {
      if (e.code !== "P2034" || n === 4) throw e;
    }
  }
}
