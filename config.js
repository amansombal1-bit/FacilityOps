import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  OTP_SECRET: z.string().min(32),
  JOB_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(8080),
  INTEGRATION_MODE: z.enum(["google", "local"]).default("google"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_SENDER: z.string().email().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4.1-mini"),
});
export const config = schema.parse(process.env);
if (
  config.NODE_ENV === "production" &&
  (config.INTEGRATION_MODE !== "google" ||
    !config.APP_ORIGIN.startsWith("https://"))
)
  throw new Error("Production requires Google integration and HTTPS");
if (
  config.INTEGRATION_MODE === "google" &&
  (!config.GOOGLE_CLIENT_ID ||
    !config.GOOGLE_CLIENT_SECRET ||
    !config.GOOGLE_REFRESH_TOKEN ||
    !config.GOOGLE_SENDER)
)
  throw new Error("Google OAuth sender credentials are required");
