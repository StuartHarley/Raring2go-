import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createEmailDeliveryEventDedupe,
  createEmailProviderFromEnv,
  createHttpEmailProvider,
  createMemoryEmailProvider,
  sendPasswordlessSignInEmail,
  validateEmailMessage
} from "./index";

describe("email delivery provider boundary", () => {
  it("validates provider-neutral email messages", () => {
    expect(() =>
      validateEmailMessage({
        idempotencyKey: "message_1",
        purpose: "transactional",
        to: [{ email: " Parent@Example.com " }],
        from: { email: "hello@raring2go.test" },
        subject: "Hello",
        text: "Welcome"
      })
    ).not.toThrow();

    expect(() =>
      validateEmailMessage({
        idempotencyKey: "",
        purpose: "newsletter",
        to: [],
        from: { email: "hello@raring2go.test" },
        subject: "",
        text: ""
      })
    ).toThrow("idempotency key");
  });

  it("sends passwordless sign-in through the configured provider abstraction", async () => {
    const provider = createMemoryEmailProvider();

    const result = await sendPasswordlessSignInEmail(provider, {
      to: "Parent@Example.com",
      url: "https://app.raring2go.test/sign-in/verify?token=abc",
      expiresAt: new Date("2026-08-11T10:15:00.000Z"),
      idempotencyKey: "passwordless:parent@example.com:abc"
    });

    expect(result).toMatchObject({
      providerKey: "memory",
      accepted: ["parent@example.com"],
      status: "queued"
    });
    expect(provider.sent[0]?.message.purpose).toBe("passwordless_sign_in");
  });

  it("selects environment-configured transports without exposing vendor concepts", () => {
    expect(createEmailProviderFromEnv({ EMAIL_PROVIDER: "console" } as NodeJS.ProcessEnv).providerKey).toBe("console");
    expect(createEmailProviderFromEnv({
      EMAIL_PROVIDER: "http",
      EMAIL_HTTP_ENDPOINT: "https://email-gateway.example/send",
      EMAIL_HTTP_PROVIDER_KEY: "pilot_gateway"
    } as NodeJS.ProcessEnv).providerKey).toBe("pilot_gateway");
    expect(createEmailProviderFromEnv({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587"
    } as NodeJS.ProcessEnv).providerKey).toBe("smtp");
  });

  it("posts through the generic HTTP adapter and keeps provider data at the boundary", async () => {
    const requests: RequestInit[] = [];
    const provider = createHttpEmailProvider({
      endpoint: "https://email-gateway.example/send",
      apiKey: "secret",
      providerKey: "pilot_gateway",
      fetch: async (_input, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({ id: "provider_message_1" }), {
          status: 202,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await provider.send({
      idempotencyKey: "message_1",
      purpose: "newsletter",
      to: [{ email: "parent@example.com" }],
      from: { email: "hello@raring2go.test" },
      subject: "This week",
      text: "Things to do"
    });

    expect(result).toMatchObject({
      providerKey: "pilot_gateway",
      providerMessageId: "provider_message_1",
      status: "queued"
    });
    expect(requests[0]?.headers).toMatchObject({
      authorization: "Bearer secret"
    });
  });

  it("verifies webhook signatures and supports idempotent delivery events", async () => {
    const provider = createHttpEmailProvider({
      endpoint: "https://email-gateway.example/send",
      providerKey: "pilot_gateway"
    });
    const body = JSON.stringify({
      events: [
        {
          providerKey: "pilot_gateway",
          providerMessageId: "message_1",
          eventId: "event_1",
          eventType: "delivered",
          occurredAt: "2026-08-11T10:00:00.000Z"
        }
      ]
    });
    const secret = "webhook-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    const events = await provider.verifyWebhook?.({
      headers: { "x-raring2go-email-signature": signature },
      body,
      secret
    });
    const dedupe = createEmailDeliveryEventDedupe();

    expect(events).toHaveLength(1);
    expect(dedupe.accept(events![0]!)).toBe(true);
    expect(dedupe.accept(events![0]!)).toBe(false);
  });
});
