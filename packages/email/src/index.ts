export type EmailRecipient = {
  email: string;
  name?: string | null;
};

export type EmailPurpose =
  | "passwordless_sign_in"
  | "transactional"
  | "newsletter"
  | "journey";

export type EmailMessage = {
  idempotencyKey: string;
  purpose: EmailPurpose;
  to: EmailRecipient[];
  from: EmailRecipient;
  replyTo?: EmailRecipient | null;
  subject: string;
  text: string;
  html?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

export type EmailDeliveryResult = {
  providerKey: string;
  providerMessageId: string;
  accepted: string[];
  rejected: string[];
  status: "queued" | "sent" | "failed";
  raw?: Record<string, unknown>;
};

export type EmailDeliveryEvent = {
  providerKey: string;
  providerMessageId: string;
  eventId: string;
  eventType:
    | "queued"
    | "sent"
    | "delivered"
    | "opened"
    | "clicked"
    | "bounced"
    | "complained"
    | "unsubscribed"
    | "failed";
  occurredAt: Date;
  recipientEmail?: string | null;
  metadata?: Record<string, unknown>;
};

export type EmailDeliveryProvider = {
  readonly providerKey: string;
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
  verifyWebhook?(input: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
    secret?: string;
  }): Promise<EmailDeliveryEvent[]>;
};

export type SentEmailRecord = EmailDeliveryResult & {
  message: EmailMessage;
};

export function normalizeEmailAddress(email: string) {
  const normalized = email.trim().toLowerCase();

  if (!normalized || !normalized.includes("@")) {
    throw new Error("A valid recipient email address is required.");
  }

  return normalized;
}

export function createMemoryEmailProvider(input?: {
  providerKey?: string;
  shouldFail?: boolean;
}) {
  const sent: SentEmailRecord[] = [];

  const provider: EmailDeliveryProvider & { sent: SentEmailRecord[] } = {
    providerKey: input?.providerKey ?? "memory",
    sent,
    async send(message) {
      validateEmailMessage(message);

      if (input?.shouldFail) {
        return {
          providerKey: provider.providerKey,
          providerMessageId: `failed_${message.idempotencyKey}`,
          accepted: [],
          rejected: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
          status: "failed"
        };
      }

      const result: SentEmailRecord = {
        providerKey: provider.providerKey,
        providerMessageId: `email_${message.idempotencyKey}`,
        accepted: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
        rejected: [],
        status: "queued",
        message
      };

      sent.push(result);
      return result;
    }
  };

  return provider;
}

export function createConsoleEmailProvider() {
  return {
    providerKey: "console",
    async send(message: EmailMessage) {
      validateEmailMessage(message);
      const providerMessageId = `console_${message.idempotencyKey}`;

      console.info("[email:console]", {
        idempotencyKey: message.idempotencyKey,
        purpose: message.purpose,
        to: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
        subject: message.subject,
        providerMessageId
      });

      return {
        providerKey: "console",
        providerMessageId,
        accepted: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
        rejected: [],
        status: "queued" as const
      };
    }
  } satisfies EmailDeliveryProvider;
}

export function createSmtpEmailProvider(input: {
  host: string;
  port: number;
  username?: string;
  password?: string;
  secure?: boolean;
  timeoutMs?: number;
}) {
  if (!input.host || !input.port) {
    throw new Error("SMTP email provider requires host and port.");
  }

  return {
    providerKey: "smtp",
    async send(message: EmailMessage) {
      validateEmailMessage(message);

      return {
        providerKey: "smtp",
        providerMessageId: `smtp_${message.idempotencyKey}`,
        accepted: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
        rejected: [],
        status: "queued",
        raw: {
          host: input.host,
          port: input.port,
          secure: Boolean(input.secure),
          configured: Boolean(input.username && input.password),
          delivery: "deferred_to_runtime_transport"
        }
      };
    }
  } satisfies EmailDeliveryProvider;
}

export function createHttpEmailProvider(input: {
  endpoint: string;
  apiKey?: string;
  providerKey?: string;
  fetch?: typeof fetch;
}) {
  if (!input.endpoint) {
    throw new Error("HTTP email provider requires an endpoint.");
  }

  return {
    providerKey: input.providerKey ?? "http",
    async send(message: EmailMessage) {
      validateEmailMessage(message);
      const fetcher = input.fetch ?? fetch;
      const response = await fetcher(input.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {})
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        return {
          providerKey: input.providerKey ?? "http",
          providerMessageId: `http_failed_${message.idempotencyKey}`,
          accepted: [],
          rejected: message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
          status: "failed",
          raw: {
            status: response.status
          }
        };
      }

      const payload = await response.json().catch(() => ({})) as {
        id?: string;
        accepted?: string[];
        rejected?: string[];
      };

      return {
        providerKey: input.providerKey ?? "http",
        providerMessageId: payload.id ?? `http_${message.idempotencyKey}`,
        accepted: payload.accepted ?? message.to.map((recipient) => normalizeEmailAddress(recipient.email)),
        rejected: payload.rejected ?? [],
        status: "queued",
        raw: payload
      };
    },
    async verifyWebhook({ headers, body, secret }) {
      if (secret) {
        const signature = headerValue(headers["x-raring2go-email-signature"]);
        verifyHmacSignature(body, secret, signature);
      }

      const payload = JSON.parse(body) as { events?: EmailDeliveryEvent[] };
      return payload.events ?? [];
    }
  } satisfies EmailDeliveryProvider;
}

export function createEmailProviderFromEnv(
  source: NodeJS.ProcessEnv = process.env
) {
  const provider = source.EMAIL_PROVIDER ?? "console";

  if (provider === "console") {
    return createConsoleEmailProvider();
  }

  if (provider === "smtp") {
    const port = Number(source.SMTP_PORT ?? "587");

    if (!source.SMTP_HOST || !Number.isInteger(port)) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST and numeric SMTP_PORT.");
    }

    return createSmtpEmailProvider({
      host: source.SMTP_HOST,
      port,
      username: source.SMTP_USERNAME,
      password: source.SMTP_PASSWORD,
      secure: source.SMTP_SECURE === "true"
    });
  }

  if (provider === "http") {
    if (!source.EMAIL_HTTP_ENDPOINT) {
      throw new Error("EMAIL_PROVIDER=http requires EMAIL_HTTP_ENDPOINT.");
    }

    return createHttpEmailProvider({
      endpoint: source.EMAIL_HTTP_ENDPOINT,
      apiKey: source.EMAIL_HTTP_API_KEY,
      providerKey: source.EMAIL_HTTP_PROVIDER_KEY
    });
  }

  throw new Error(`Unsupported email provider: ${provider}`);
}

export async function sendPasswordlessSignInEmail(
  provider: EmailDeliveryProvider,
  input: {
    to: string;
    url: string;
    expiresAt: Date;
    from?: string;
    idempotencyKey: string;
  }
) {
  return provider.send({
    idempotencyKey: input.idempotencyKey,
    purpose: "passwordless_sign_in",
    to: [{ email: input.to }],
    from: { email: input.from ?? "no-reply@raring2go.local", name: "Raring2go" },
    subject: "Your Raring2go sign-in link",
    text: [
      "Use this secure link to sign in to Raring2go:",
      input.url,
      "",
      `This link expires at ${input.expiresAt.toISOString()}.`
    ].join("\n"),
    html: `<p>Use this secure link to sign in to Raring2go:</p><p><a href="${escapeHtml(input.url)}">Sign in</a></p><p>This link expires at ${input.expiresAt.toISOString()}.</p>`,
    metadata: {
      purpose: "passwordless_sign_in"
    }
  });
}

export function validateEmailMessage(message: EmailMessage) {
  if (!message.idempotencyKey) {
    throw new Error("Email messages require an idempotency key.");
  }

  if (!message.to.length) {
    throw new Error("Email messages require at least one recipient.");
  }

  for (const recipient of message.to) {
    normalizeEmailAddress(recipient.email);
  }

  normalizeEmailAddress(message.from.email);

  if (!message.subject.trim()) {
    throw new Error("Email messages require a subject.");
  }

  if (!message.text.trim() && !message.html?.trim()) {
    throw new Error("Email messages require text or html content.");
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createEmailDeliveryEventDedupe() {
  const seen = new Set<string>();

  return {
    accept(event: EmailDeliveryEvent) {
      const key = `${event.providerKey}:${event.eventId}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    }
  };
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function verifyHmacSignature(body: string, secret: string, signature?: string) {
  if (!signature) {
    throw new Error("Email webhook signature is required.");
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Email webhook signature is invalid.");
  }
}
import { createHmac, timingSafeEqual } from "node:crypto";
