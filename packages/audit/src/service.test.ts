import { describe, expect, it, vi } from "vitest";
import { auditActions } from "./actions";
import { listAuditEvents, recordAuditEvent } from "./service";
import type { AuditDatabase } from "./types";

const fixtureEvent = {
  id: "00000000-0000-4000-8000-000000000901",
  actorUserId: "00000000-0000-4000-8000-000000000201",
  action: auditActions.recordUpdate,
  entityType: "franchise_agreement",
  entityId: "00000000-0000-4000-8000-000000000801",
  organisationId: "00000000-0000-4000-8000-000000000001",
  territoryId: "00000000-0000-4000-8000-000000000101",
  payload: {},
  createdAt: new Date("2026-08-10T12:00:00.000Z")
};

function createInsertDb() {
  const returning = vi.fn().mockResolvedValue([fixtureEvent]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as AuditDatabase,
    insert,
    values,
    returning
  };
}

function createSelectDb() {
  const limit = vi.fn().mockResolvedValue([fixtureEvent]);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return {
    db: { select } as unknown as AuditDatabase,
    select,
    where,
    limit
  };
}

describe("recordAuditEvent", () => {
  it("records a human actor with scope, changes and redacted metadata", async () => {
    const { db, values } = createInsertDb();

    await recordAuditEvent(db, {
      action: auditActions.recordUpdate,
      actor: {
        type: "human",
        userId: "00000000-0000-4000-8000-000000000201"
      },
      entity: {
        type: "franchise_agreement",
        id: "00000000-0000-4000-8000-000000000801"
      },
      scope: {
        organisationId: "00000000-0000-4000-8000-000000000001",
        territoryId: "00000000-0000-4000-8000-000000000101"
      },
      context: {
        correlationId: "corr_123",
        requestId: "req_123"
      },
      changes: [
        {
          field: "status",
          before: "draft",
          after: "approved"
        }
      ],
      metadata: {
        accessToken: "secret-token",
        visibleNote: "approved after review"
      }
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "00000000-0000-4000-8000-000000000201",
        action: auditActions.recordUpdate,
        entityType: "franchise_agreement",
        organisationId: "00000000-0000-4000-8000-000000000001",
        territoryId: "00000000-0000-4000-8000-000000000101",
        payload: expect.objectContaining({
          actor: {
            type: "human",
            userId: "00000000-0000-4000-8000-000000000201"
          },
          metadata: {
            accessToken: "[REDACTED]",
            visibleNote: "approved after review"
          }
        })
      })
    );
  });

  it("records AI attribution without pretending AI is a user", async () => {
    const { db, values } = createInsertDb();

    await recordAuditEvent(db, {
      action: auditActions.aiGenerate,
      actor: {
        type: "ai",
        mode: "human_approved",
        provider: "example-provider",
        model: "editorial-model",
        runId: "ai_run_123",
        approvedByUserId: "00000000-0000-4000-8000-000000000201"
      },
      entity: {
        type: "content_item",
        id: "00000000-0000-4000-8000-000000000802"
      }
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        action: auditActions.aiGenerate,
        payload: expect.objectContaining({
          actor: expect.objectContaining({
            type: "ai",
            mode: "human_approved",
            approvedByUserId: "00000000-0000-4000-8000-000000000201"
          })
        })
      })
    );
  });

  it("supports transaction participation by using the supplied db object", async () => {
    const { db, insert } = createInsertDb();

    await recordAuditEvent(db, {
      action: auditActions.systemRun,
      actor: {
        type: "automation",
        automationId: "workflow.edition-preflight",
        runId: "job_123"
      },
      entity: {
        type: "job",
        id: "00000000-0000-4000-8000-000000000803"
      }
    });

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("fails before writing invalid action names", async () => {
    const { db, insert } = createInsertDb();

    await expect(
      recordAuditEvent(db, {
        action: "bad action name",
        actor: {
          type: "system",
          systemId: "seed"
        },
        entity: {
          type: "organisation"
        }
      })
    ).rejects.toThrow("Invalid audit action");

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("listAuditEvents", () => {
  it("queries by actor, entity, scope and bounded limit", async () => {
    const { db, where, limit } = createSelectDb();

    await listAuditEvents(db, {
      actorUserId: "00000000-0000-4000-8000-000000000201",
      entityType: "franchise_agreement",
      entityId: "00000000-0000-4000-8000-000000000801",
      organisationId: "00000000-0000-4000-8000-000000000001",
      territoryId: "00000000-0000-4000-8000-000000000101",
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-08-31T23:59:59.999Z"),
      limit: 999
    });

    expect(where).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith(250);
  });
});
