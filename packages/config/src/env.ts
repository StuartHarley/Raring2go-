import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "preview", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_NAME: z
    .string()
    .min(1)
    .default("Raring2go Business-in-a-Box")
});

export type AppEnv = z.infer<typeof envSchema>;

export function createEnv(source: NodeJS.ProcessEnv): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}
