import { describe, expect, it } from "vitest";
import { dueComplianceReminders, isReminderUndeliverable, scheduleOverdueComplianceReminders } from "./service";
import type { FranchiseData } from "./types";

const base = (): FranchiseData => ({
  franchises: [{ id: "f1", franchiseOrganisationId: "o1", primaryTerritoryId: "t1", primaryOwnerUserId: "u1", status: "active", lifecycleStage: "operating", onboardingStatus: "complete", supportStatus: "ok", tags: [] } as never],
  contacts: [], organisations: [], territories: [],
  users: [{ id: "u1", email: "owner@example.test", displayName: "Olive Owner" }],
  complianceActions: [{ id: "a1", franchiseId: "f1", status: "open", severity: "critical", title: "Insurance: expired", dueDate: "2026-08-01", idempotencyKey: "franchise:f1:compliance:r1:expired" } as never],
  complianceReminders: [{ id: "r1", franchiseId: "f1", complianceActionId: "a1", reminderType: "expired", scheduledFor: "2026-08-01", status: "scheduled", idempotencyKey: "franchise:f1:compliance:r1:expired:reminder" }]
});

describe("overdue compliance reminders", () => {
  it("waits a week past the due date, then schedules exactly one firmer reminder", () => {
    expect(scheduleOverdueComplianceReminders(base(), "2026-08-07", () => "n1")).toEqual([]);
    const data = base();
    const [reminder] = scheduleOverdueComplianceReminders(data, "2026-08-08", () => "n1");
    expect(reminder).toMatchObject({ complianceActionId: "a1", reminderType: "overdue", scheduledFor: "2026-08-08", status: "scheduled", idempotencyKey: "franchise:f1:compliance:r1:expired:overdue" });
    expect(scheduleOverdueComplianceReminders(data, "2026-09-30", () => "n2")).toEqual([]);
    expect(data.complianceReminders).toHaveLength(2);
  });

  it("does not chase a requirement that has been resolved", () => {
    const data = base();
    data.complianceActions![0]!.status = "resolved";
    expect(scheduleOverdueComplianceReminders(data, "2026-09-30")).toEqual([]);
  });
});

describe("due compliance reminders", () => {
  it("selects reminders that are due, with the franchise owner as recipient", () => {
    expect(dueComplianceReminders(base(), "2026-07-31")).toEqual([]);
    const [due] = dueComplianceReminders(base(), "2026-08-01");
    expect(due).toMatchObject({ recipient: { email: "owner@example.test", name: "Olive Owner" } });
    expect(due!.skip).toBeUndefined();
  });

  it("flags a resolved requirement and a missing recipient instead of sending", () => {
    const resolved = base();
    resolved.complianceActions![0]!.status = "resolved";
    expect(dueComplianceReminders(resolved, "2026-08-02")[0]!.skip).toBe("action_resolved");

    const noOwner = base();
    noOwner.franchises[0]!.primaryOwnerUserId = null;
    expect(dueComplianceReminders(noOwner, "2026-08-02")[0]).toMatchObject({ skip: "no_recipient", recipient: undefined });
  });

  it("ignores reminders already sent or cancelled", () => {
    const data = base();
    data.complianceReminders![0]!.status = "sent";
    expect(dueComplianceReminders(data, "2026-08-02")).toEqual([]);
  });

  it("gives up on an undeliverable reminder after two weeks", () => {
    const reminder = base().complianceReminders![0]!;
    expect(isReminderUndeliverable(reminder, "2026-08-14")).toBe(false);
    expect(isReminderUndeliverable(reminder, "2026-08-15")).toBe(true);
  });
});
