import { enqueue } from "./db.js";
export async function notify(tx, task, event, version = task.version) {
  const users =
    event === "assigned" || event === "rejected" || event === "approved"
      ? [task.assignedTo]
      : await tx.user.findMany({ where: { role: "FM", active: true } });
  for (const u of users)
    if (u.active)
      await enqueue(
        tx,
        `${task.id}:${version}:${event}:${u.id}`,
        "mail",
        { recipient: u.email, event, taskVersion: version },
        task.id,
      );
}
