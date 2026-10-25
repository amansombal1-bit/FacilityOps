import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
process.env.INTEGRATION_MODE = "local";
process.env.OTP_SECRET = "browser-test-secret-longer-than-32-characters";
process.env.JOB_SECRET = "browser-job-secret-longer-than-32-characters";
process.env.APP_ORIGIN = "http://localhost:8080";
process.env.DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1";
const pg = await PGlite.create();
for (const m of ["202610250001_initial", "202610250002_audit_guard"])
  await pg.exec(
    await readFile(
      new URL("../prisma/migrations/" + m + "/migration.sql", import.meta.url),
      "utf8",
    ),
  );
const socket = new PGLiteSocketServer({
  db: pg,
  port: 55433,
  host: "127.0.0.1",
});
await socket.start();
const { db } = await import("../server/db.js");
const { app } = await import("../server/app.js");
const { drain } = await import("../server/worker.js");
const server = app.listen(8080);
let browser;
try {
  const fm = await db.user.create({
    data: {
      name: "Test Facility Manager",
      email: "manager@example.test",
      role: "FM",
    },
  });
  const fot = await db.user.create({
    data: {
      name: "Test Floor In-charge",
      email: "floor@example.test",
      role: "FOT",
    },
  });
  await db.settings.create({ data: { driveRootId: "local-root" } });
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch {
    const bundled = (await import("@sparticuz/chromium")).default;
    browser = await chromium.launch({
      headless: true,
      executablePath: await bundled.executablePath(),
      args: bundled.args.filter(
        (a) =>
          !a.includes("disable-web-security") &&
          !a.includes("allow-running-insecure-content"),
      ),
    });
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8080");
  await page.getByLabel("Work email").fill(fm.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("Six-digit verification code").waitFor();
  await drain(5);
  const attempt = await db.emailAttempt.findFirst({
    orderBy: { createdAt: "desc" },
  });
  const mail = JSON.parse(
    await readFile(
      new URL("../.local/mail-" + attempt.jobId + ".json", import.meta.url),
      "utf8",
    ),
  );
  await page
    .getByLabel("Six-digit verification code")
    .fill(mail.body.match(/\b\d{6}\b/)[0]);
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.getByRole("button", { name: "Create task" }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Inspect classroom lighting");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Check fixtures and replace faulty lamps.");
  await page.getByLabel("Assigned FOT").selectOption(fot.id);
  await page.getByLabel("Deadline (Asia/Kolkata)").fill("2030-10-26T10:00");
  await page.getByRole("button", { name: "Save task" }).click();
  await page
    .getByRole("button", { name: "Inspect classroom lighting", exact: true })
    .waitFor();
  await mkdir("/tmp/facilityops-visuals", { recursive: true });
  await page.screenshot({
    path: "/tmp/facilityops-visuals/dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect classroom lighting", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Inspect classroom lighting" })
    .waitFor();
  await page.getByRole("button", { name: "Back to register" }).click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByRole("heading", { name: "Team & access" }).waitFor();
  await page.getByRole("button", { name: "Automation", exact: true }).click();
  await page.getByRole("heading", { name: "Automation rules" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/facilityops-visuals/mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page must not overflow horizontally",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.locator(".mobile-signout").click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  console.log(
    "Browser smoke PASS: OTP sign-in, task creation/detail, Team, Automation, mobile layout, sign-out; zero JS errors.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await db.$disconnect();
  await socket.stop();
  await pg.close();
}
