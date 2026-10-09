export const signWellConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.SIGNWELL_API_KEY);
/** Documents are test documents (watermarked, not legally binding) unless this is explicitly turned off. */
export const signWellTestMode = (env: Record<string, string | undefined> = process.env) => env.SIGNWELL_TEST_MODE !== "false";
