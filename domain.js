import { DateTime } from "luxon";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(ok, status, message) {
  if (!ok) throw new HttpError(status, message);
}
export const unresolved = ["Open", "InProgress", "AwaitingApproval"];
export const editable = ["Open", "InProgress"];
export function owner(user, task) {
  ensure(
    user.id === task.assignedToId,
    403,
    "Only the assigned FOT can perform this action",
  );
}
export function fm(user) {
  ensure(user.role === "FM", 403, "FM access required");
}
export function interval(priority) {
  return (priority === "Normal" ? 24 : 3) * 3600000;
}
export function quietAdjusted(date, settings) {
  const d = DateTime.fromJSDate(date, { zone: "Asia/Kolkata" });
  const a = settings.quietStart,
    b = settings.quietEnd;
  if (a == null || b == null || a === b) return date;
  const quiet = a < b ? d.hour >= a && d.hour < b : d.hour >= a || d.hour < b;
  if (!quiet) return date;
  let end = d.set({ hour: b, minute: 0, second: 0, millisecond: 0 });
  if (end <= d) end = end.plus({ days: 1 });
  return end.toJSDate();
}
export function validateSubmission(task, evidence, action) {
  ensure(
    editable.includes(task.status),
    409,
    "Task cannot be submitted in this status",
  );
  ensure(
    action.trim().length >= 10,
    400,
    "Corrective action must contain at least 10 characters",
  );
  const ready = evidence.filter(
    (e) =>
      e.cycle === task.cycle &&
      e.state === "Ready" &&
      e.userId === task.assignedToId,
  );
  ensure(
    ready.some((e) => e.kind === "after"),
    400,
    "A successfully uploaded completion photo is required",
  );
  if (task.beforeRequired)
    ensure(
      ready.some((e) => e.kind === "before"),
      400,
      "A before photo is required",
    );
  for (const e of ready) {
    if (task.gpsRequired)
      ensure(
        e.latitude != null &&
          e.longitude != null &&
          e.accuracy != null &&
          e.gpsAt,
        400,
        "GPS evidence is required",
      );
    if (task.cameraRequired)
      ensure(e.source === "camera", 400, "Fresh camera capture required");
  }
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function taskText(t) {
  return `FO-${String(t.number).padStart(5, "0")} | ${t.title}\nFloor: ${t.floor} / ${t.room}\nOwner: ${t.assignedTo.name}\nPriority: ${t.priority}\nDeadline: ${DateTime.fromJSDate(t.deadline).setZone("Asia/Kolkata").toFormat("dd LLL yyyy HH:mm")} IST\nStatus: ${t.status}`;
}
