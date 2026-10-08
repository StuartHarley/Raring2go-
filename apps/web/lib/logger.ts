import { createLogger, resolveLogLevel } from "@raring2go/observability";

export const appLogger = createLogger({ service: "raring2go-web", level: resolveLogLevel(process.env.LOG_LEVEL) });
