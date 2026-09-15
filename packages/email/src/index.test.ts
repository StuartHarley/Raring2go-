import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createEmailDeliveryEventDedupe,
  createEmailProviderFromEnv,
  createHttpEmailProvider,
  createMemoryEmailProvider,
  createMicrosoftGraphEmailProvider,
  createPostmarkEmailProvider,
  sendEmailBatch,
  sendPasswordlessSignInEmail,
  validateEmailMessage
} from "./index";
import type { EmailDeliveryProvider, EmailMessage } from "./index";

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

  it("batches newsletter sends through Postmark's batch endpoint and forwards custom headers", async () => {
    const requests: Array<{ url: string; body: Array<Record<string, unknown>> }> = [];
    const provider = createPostmarkEmailProvider({
      serverToken: "postmark-secret-token",
      endpoint: "https://postmark.test",
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
        requests.push({ url: String(url), body });
        return new Response(
          JSON.stringify(body.map((_, index) => ({ MessageID: `pm_batch_${index}`, SubmittedAt: "2026-08-11T10:00:00.000Z" }))),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    const messages: EmailMessage[] = [
      {
        idempotencyKey: "newsletter_batch_1",
        purpose: "newsletter",
        to: [{ email: "one@example.com" }],
        from: { email: "hello@mail.raring2go.co.uk" },
        subject: "This week",
        text: "Things to do",
        headers: { "List-Unsubscribe": "<mailto:unsubscribe@raring2go.co.uk>" }
      },
      {
        idempotencyKey: "newsletter_batch_2",
        purpose: "newsletter",
        to: [{ email: "two@example.com" }],
        from: { email: "hello@mail.raring2go.co.uk" },
        subject: "This week",
        text: "Things to do"
      }
    ];

    const results = await provider.sendBatch?.(messages);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://postmark.test/email/batch");
    expect(requests[0]?.body).toHaveLength(2);
    expect(requests[0]?.body[0]?.Headers).toEqual([
      { Name: "List-Unsubscribe", Value: "<mailto:unsubscribe@raring2go.co.uk>" }
    ]);
    expect(requests[0]?.body[1]?.Headers).toBeUndefined();
    expect(results).toEqual([
      expect.objectContaining({ providerMessageId: "pm_batch_0", status: "queued" }),
      expect.objectContaining({ providerMessageId: "pm_batch_1", status: "queued" })
    ]);
  });

  it("splits oversized batches across multiple Postmark batch calls", async () => {
    const requests: Array<Array<Record<string, unknown>>> = [];
    const provider = createPostmarkEmailProvider({
      serverToken: "postmark-secret-token",
      endpoint: "https://postmark.test",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
        requests.push(body);
        return new Response(
          JSON.stringify(body.map((_, index) => ({ MessageID: `pm_${requests.length}_${index}` }))),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });
    const messages: EmailMessage[] = Array.from({ length: 501 }, (_, index) => ({
      idempotencyKey: `bulk_${index}`,
      purpose: "newsletter" as const,
      to: [{ email: `person${index}@example.com` }],
      from: { email: "hello@mail.raring2go.co.uk" },
      subject: "This week",
      text: "Things to do"
    }));

    const results = await provider.sendBatch?.(messages);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toHaveLength(500);
    expect(requests[1]).toHaveLength(1);
    expect(results).toHaveLength(501);
  });

  it("falls back to sequential sends when a provider has no batch endpoint", async () => {
    const provider = createMemoryEmailProvider();
    const messages: EmailMessage[] = [
      {
        idempotencyKey: "seq_1",
        purpose: "newsletter",
        to: [{ email: "one@example.com" }],
        from: { email: "hello@raring2go.test" },
        subject: "Hello",
        text: "Hi"
      },
      {
        idempotencyKey: "seq_2",
        purpose: "newsletter",
        to: [{ email: "two@example.com" }],
        from: { email: "hello@raring2go.test" },
        subject: "Hello",
        text: "Hi"
      }
    ];

    const results = await sendEmailBatch(provider, messages);

    expect(results).toHaveLength(2);
    expect(provider.sent.map((record) => record.message.idempotencyKey)).toEqual(["seq_1", "seq_2"]);
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

  it("sends through Microsoft Graph as the connected mailbox and has no batch or webhook support", async () => {
    const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const provider: EmailDeliveryProvider = createMicrosoftGraphEmailProvider({
      getAccessToken: async () => "graph-access-token",
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return new Response(null, { status: 202 });
      }
    });

    const result = await provider.send({
      idempotencyKey: "outlook_1",
      purpose: "newsletter",
      to: [{ email: "Parent@Example.com" }],
      from: { email: "franchisee@raring2go.co.uk", name: "Sutton Coldfield" },
      subject: "Half term ideas",
      text: "Things to do",
      html: "<p>Things to do</p>"
    });

    expect(requests[0]?.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(requests[0]?.authorization).toBe("Bearer graph-access-token");
    const body = requests[0]?.body as { message: { toRecipients: Array<{ emailAddress: { address: string } }> } };
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "parent@example.com" } }]);
    expect(result).toMatchObject({ providerKey: "microsoft-graph", status: "queued", accepted: ["parent@example.com"] });
    expect(provider.sendBatch).toBeUndefined();
    expect(provider.verifyWebhook).toBeUndefined();
  });

  it("maps a Microsoft Graph rejection and an access-token failure to recoverable failed results", async () => {
    const rejected = createMicrosoftGraphEmailProvider({
      getAccessToken: async () => "graph-access-token",
      fetch: async () => new Response(JSON.stringify({
        error: { code: "ErrorSendAsDenied", message: "Client does not have permissions to send as this user." }
      }), { status: 403, headers: { "content-type": "application/json" } })
    });
    const tokenFailure = createMicrosoftGraphEmailProvider({
      getAccessToken: async () => {
        throw new Error("Outlook mailbox connection has expired.");
      }
    });
    const message = {
      idempotencyKey: "outlook_2",
      purpose: "newsletter" as const,
      to: [{ email: "person@example.com" }],
      from: { email: "franchisee@raring2go.co.uk" },
      subject: "Hello",
      text: "Hello"
    };

    await expect(rejected.send(message)).resolves.toMatchObject({
      status: "failed",
      rejected: ["person@example.com"],
      raw: { status: 403, code: "ErrorSendAsDenied" }
    });
    await expect(tokenFailure.send(message)).resolves.toMatchObject({
      status: "failed",
      raw: { reason: "provider_outage", message: "Outlook mailbox connection has expired." }
    });
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
