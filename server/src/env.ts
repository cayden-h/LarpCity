import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  DATABASE_URL: z.string().min(1),

  PERSONA_API_KEY: z.string().min(1),
  PERSONA_WEBHOOK_SECRET: z.string().min(1),
  PERSONA_API_VERSION: z.string().min(1).default("2025-12-08"),

  NESSIE_API_KEY: z.string().min(1),
  NESSIE_BASE_URL: z.string().url().default("https://api.nessieisreal.com"),
  NESSIE_TAG: z.string().min(1).default("larpcity"),

  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().min(1),
  ELEVENLABS_VOICE_MAYOR: z.string().min(1),
  ELEVENLABS_VOICE_ANCHOR: z.string().min(1),

  GEMINI_API_KEYS: z.string().min(1),
  GEMINI_TEXT_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-image"),

  BACKBOARD_API_KEY: z.string().min(1),
  BACKBOARD_COACH_ASSISTANT_ID: z.string().min(1),
  BACKBOARD_SMALL_MODEL: z.string().min(1),
  BACKBOARD_LARGE_MODEL: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  return schema.parse(raw);
}

export const env: Env = parseEnv(process.env);

export const geminiKeys: string[] = env.GEMINI_API_KEYS.split(",")
  .map((k) => k.trim())
  .filter(Boolean);
