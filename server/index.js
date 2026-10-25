import { app } from "./app.js";
import { db } from "./db.js";
import { config } from "./config.js";
const server = app.listen(config.PORT, "0.0.0.0", () =>
  console.log(`FacilityOps listening on ${config.PORT}`),
);
process.on("SIGTERM", () => {
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});
