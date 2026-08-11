import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createEmailDeliveryEventDedupe,
  createEmailProviderFromEnv,
  createHttpEmailProvider,
  createMemoryEmailProvider,
  createPostmarkEmailProvider,
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
    expect(createEmailProviderFromEnv({
      EMAIL_PROVIDER: "postmark",
      POSTMARK_SERVER_TOKEN: "server-token"
    } as NodeJS.ProcessEnv).providerKey).toBe("postmark");
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

  it("sends transactional and newsletter email through Postmark streams without leaking credentials", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const provider = createPostmarkEmailProvider({
      serverToken: "postmark-secret-token",
      transactionalMessageStream: "transactional-pilot",
      broadcastMessageStream: "broadcast-pilot",
      endpoint: "https://postmark.test",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          init: init ?? {},
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return new Response(JSON.stringify({ MessageID: `pm_${requests.length}`, SubmittedAt: "2026-08-11T10:00:00.000Z" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const transactional = await provider.send({
      idempotencyKey: "transactional_1",
      purpose: "transactional",
      to: [{ email: "Advertiser@Example.com" }],
      from: { email: "hello@mail.raring2go.co.uk", name: "Raring2go" },
      subject: "Booking confirmed",
      text: "Your booking is confirmed."
    });
    await provider.send({
      idempotencyKey: "newsletter_1",
      purpose: "newsletter",
      to: [{ email: "Parent@Example.com" }],
      from: { email: "hello@mail.raring2go.co.uk" },
      subject: "This week",
      text: "Things to do"
    });

    expect(transactional).toMatchObject({
      providerKey: "postmark",
      providerMessageId: "pm_1",
      accepted: ["advertiser@example.com"],
      status: "queued"
    });
    expect(requests[0]?.url).toBe("https://postmark.test/email");
    expect(requests[0]?.body.MessageStream).toBe("transactional-pilot");
    expect(requests[1]?.body.MessageStream).toBe("broadcast-pilot");
    expect(transactional.raw).not.toHaveProperty("serverToken");
    expect(JSON.stringify(transactional.raw)).not.toContain("postmark-secret-token");
  });

  it("maps Postmark provider rejection and outage to recoverable failed delivery results", async () => {
    const rejected = createPostmarkEmailProvider({
      serverToken: "server-token",
      fetch: async () => new Response(JSON.stringify({
        ErrorCode: 300,
        Message: "Inactive recipient"
      }), {
        status: 422,
        headers: { "content-type": "application/json" }
      })
    });
    const unavailable = createPostmarkEmailProvider({
      serverToken: "server-token",
      fetch: async () => {
        throw new Error("network unavailable");
      }
    });
    const message = {
      idempotencyKey: "message_1",
      purpose: "transactional" as const,
      to: [{ email: "person@example.com" }],
      from: { email: "hello@mail.raring2go.co.uk" },
      subject: "Hello",
      text: "Hello"
    };

    await expect(rejected.send(message)).resolves.toMatchObject({
      status: "failed",
      rejected: ["person@example.com"],
      raw: { status: 422, errorCode: 300 }
    });
    await expect(unavailable.send(message)).resolves.toMatchObject({
      status: "failed",
      raw: { reason: "provider_outage" }
    });
  });

  it("maps and deduplicates Postmark delivery, bounce and complaint webhooks", async () => {
    const provider = createPostmarkEmailProvider({ serverToken: "server-token" });
    const events = await provider.verifyWebhook?.({
      headers: { authorization: "Bearer webhook-secret" },
      secret: "webhook-secret",
      body: JSON.stringify([
        {
          RecordType: "Delivery",
          MessageID: "message_1",
          ID: 11,
          Email: "Parent@Example.com",
          DeliveredAt: "2026-08-11T10:00:00.000Z"
        },
        {
          RecordType: "Bounce",
          MessageID: "message_1",
          ID: 12,
          Email: "Parent@Example.com",
          ReceivedAt: "2026-08-11T10:05:00.000Z"
        },
        {
          RecordType: "SpamComplaint",
          MessageID: "message_1",
          ID: 13,
          Email: "Parent@Example.com",
          ReceivedAt: "2026-08-11T10:06:00.000Z"
        }
      ])
    });
    const dedupe = createEmailDeliveryEventDedupe();

    expect(events?.map((event) => event.eventType)).toEqual(["delivered", "bounced", "complained"]);
    expect(events?.[1]).toMatchObject({
      providerKey: "postmark",
      providerMessageId: "message_1",
      recipientEmail: "parent@example.com"
    });
    expect(dedupe.accept(events![1]!)).toBe(true);
    expect(dedupe.accept(events![1]!)).toBe(false);
  });

  it("fails closed for missing Postmark configuration and invalid webhook secrets", async () => {
    expect(() => createEmailProviderFromEnv({
      EMAIL_PROVIDER: "postmark"
    } as NodeJS.ProcessEnv)).toThrow("POSTMARK_SERVER_TOKEN");

    const provider = createPostmarkEmailProvider({ serverToken: "server-token" });
    await expect(provider.verifyWebhook?.({
      headers: { authorization: "Bearer wrong" },
      secret: "webhook-secret",
      body: JSON.stringify({ RecordType: "Delivery", MessageID: "message_1" })
    })).rejects.toThrow("webhook secret");
  });
});
