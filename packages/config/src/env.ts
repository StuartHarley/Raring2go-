import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "preview", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .min(1)
    .default("Raring2go Business-in-a-Box"),
  APP_URL: z
    .url()
    .optional(),
  NEXT_PUBLIC_SITE_URL: z
    .url()
    .optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function createEnv(source: NodeJS.ProcessEnv): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
