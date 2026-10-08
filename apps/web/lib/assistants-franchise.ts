import { agreementComparisonTask, diffAgreementContent, franchiseBriefingTask } from "@raring2go/assistants";
import type { AgreementComparisonOutput, FranchiseBriefingOutput, FranchiseFacts } from "@raring2go/assistants";
import { createDb } from "@raring2go/db";
import { loadFranchiseData } from "@raring2go/franchise";
import type { Franchise360, FranchiseActorContext } from "@raring2go/franchise";
import { evaluatePermission } from "@raring2go/permissions";
import { readTerritoryHealth } from "./analytics-runtime";
import { assistantsConfigured, latestAssistantOutput, runAssistant } from "./assistants-runtime";
import type { AssistantActor } from "./assistants-runtime";
import { readFranchise360 } from "./franchise-runtime";
import { getPermissionData } from "./permission-source";

const DAY = 86_400_000;
const isoDay = (value: string | Date | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * The franchise's records as the plain facts the assistant may use. They come from `getFranchise360`, which already
 * limited them to what the actor may see, so the assistant never knows more than the person asking.
 */
export function buildFranchiseFacts(view: Franchise360, health: Awaited<ReturnType<typeof readTerritoryHealth>>, now: Date = new Date()): FranchiseFacts {
  const programmeTasks = view.onboarding.tasks.filter((task) => !task.deletedAt);
  const byRef = new Map<string, (typeof programmeTasks)[number]>();
  for (const task of programmeTasks) {
    byRef.set(task.id, task);
    if (task.templateTaskId) byRef.set(task.templateTaskId, task);
  }
  const agreementExecuted = view.agreement?.status === "executed";

  const tasks = programmeTasks
    .filter((task) => task.status !== "completed")
    .map((task) => {
      const waitingOn: string[] = [];
      for (const rule of task.dependencyRules) {
        if (rule.type === "task" && rule.id) {
          const needed = byRef.get(rule.id);
          if (needed && needed.status !== "completed") waitingOn.push(needed.title);
        } else if (rule.type === "executed_agreement" && !agreementExecuted) waitingOn.push("the agreement being signed");
      }
      return { id: task.id, title: task.title, phase: task.phaseName, ownerType: String(task.ownerType), dueOn: task.dueDate ?? null, required: task.required, status: String(task.status), waitingOn };
    });

  const missing = view.compliance.requirements.filter((requirement) => requirement.active && (!requirement.record || ["missing", "rejected"].includes(String(requirement.record.status)))).map((requirement) => requirement.name);
  const expiring = view.compliance.requirements
    .filter((requirement) => requirement.record?.expiresAt)
    .map((requirement) => ({ name: requirement.name, expiresOn: requirement.record!.expiresAt!, withinDays: Math.round((new Date(`${requirement.record!.expiresAt}T00:00:00Z`).getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY), warnDays: requirement.expiryWarningDays }))
    .filter((entry) => entry.withinDays <= entry.warnDays)
    .map(({ name, expiresOn, withinDays }) => ({ name, expiresOn, withinDays }));

  const healthFacts =
    health && health.result.score != null
      ? (() => {
          const scored = health.result.factors.filter((factor) => factor.state === "scored" && factor.normalised != null);
          const byScore = [...scored].sort((a, b) => a.normalised! - b.normalised!);
          return {
            score: health.result.score,
            band: health.result.band,
            configVersion: health.configVersion,
            weakest: byScore.slice(0, 3).map((factor) => ({ metric: factor.metric, label: factor.label, normalised: factor.normalised!, raw: factor.raw })),
            strongest: [...byScore].reverse().slice(0, 3).map((factor) => ({ metric: factor.metric, label: factor.label, normalised: factor.normalised! }))
          };
        })()
      : null;

  return {
    franchiseName: view.organisation.name,
    territoryName: view.territory.name,
    lifecycleStage: String(view.franchise.lifecycleStage),
    status: String(view.franchise.status),
    launchDate: view.franchise.launchDate ?? null,
    renewalDate: view.franchise.renewalDate ?? null,
    onboarding: {
      status: view.onboarding.programme ? String(view.onboarding.programme.status) : null,
      progressPercent: view.onboarding.progress,
      targetLaunchOn: view.onboarding.programme?.targetLaunchDate ?? null,
      launchReady: view.onboarding.launchReady,
      openBlockers: view.onboarding.blockers.filter((blocker) => blocker.status === "open").map((blocker) => ({ title: blocker.title, notes: blocker.notes ?? null })),
      tasks
    },
    compliance: {
      complete: view.compliance.completeCount,
      total: view.compliance.totalCount,
      missing,
      expiring,
      openActions: view.complianceActions.filter((action) => !["resolved", "dismissed", "closed"].includes(String(action.status))).map((action) => ({ id: action.id, title: action.title, severity: String(action.severity), dueOn: action.dueDate ?? null }))
    },
    insurance: { policies: view.insurancePolicies.map((policy) => ({ provider: policy.provider, endsOn: policy.coverEndDate, verification: String(policy.verificationStatus) })) },
    agreement: { status: view.agreement ? String(view.agreement.status) : null, version: view.agreement?.version.version ?? null },
    health: healthFacts
  };
}

export type FranchisePanel = {
  facts: FranchiseFacts;
  briefing?: { runId: string; createdAt: Date; output: FranchiseBriefingOutput };
  canAssist: boolean;
  aiConfigured: boolean;
  today: string;
  /** Head Office only: pairs of agreement versions that can be compared. */
  agreementVersions: Array<{ id: string; label: string; templateName: string }>;
  comparison?: { runId: string; createdAt: Date; approvalState: string; output: AgreementComparisonOutput };
  canCompare: boolean;
};

const compareSubject = (franchiseId: string) => ({ type: "agreement_comparison", id: franchiseId });

export async function readFranchisePanel(actor: AssistantActor, franchiseId: string): Promise<FranchisePanel> {
  const frActor: FranchiseActorContext = { userId: actor.userId, organisationId: actor.organisationId ?? "", territoryId: actor.territoryId ?? undefined };
  const view = await readFranchise360(frActor, franchiseId);
  const permissions = await getPermissionData();
  const ctx = { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined };
  const canAssist = evaluatePermission({ userId: actor.userId, module: "franchise", action: "ai_assist", context: ctx }, permissions).allowed;
  // Comparing agreement versions is a Head Office task: it needs the assistant at network level, not just for one territory.
  const canCompare = evaluatePermission({ userId: actor.userId, module: "franchise", action: "ai_assist" }, permissions).allowed;

  const health = await readTerritoryHealth(actor, view.territory.id).catch(() => undefined);
  const [briefing, comparison] = await Promise.all([
    latestAssistantOutput<FranchiseBriefingOutput>(actor, franchiseBriefingTask, { type: "franchise", id: franchiseId }).catch(() => undefined),
    canCompare ? latestAssistantOutput<AgreementComparisonOutput>(actor, agreementComparisonTask, compareSubject(franchiseId)).catch(() => undefined) : Promise.resolve(undefined)
  ]);

  let agreementVersions: FranchisePanel["agreementVersions"] = [];
  if (canCompare) {
    const { db, sql } = createDb();
    try {
      const data = await loadFranchiseData(db);
      const templates = new Map((data.agreementTemplates ?? []).map((template) => [template.id, template.name]));
      agreementVersions = (data.agreementVersions ?? [])
        .filter((version) => !version.deletedAt)
        .map((version) => ({ id: version.id, label: `${templates.get(version.templateId) ?? "Agreement"} v${version.version} (${version.status})`, templateName: templates.get(version.templateId) ?? "Agreement" }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } finally {
      await sql.end();
    }
  }

  return {
    facts: buildFranchiseFacts(view, health),
    briefing: briefing ? { runId: briefing.run.id, createdAt: briefing.run.createdAt, output: briefing.output } : undefined,
    canAssist,
    aiConfigured: assistantsConfigured(),
    today: isoDay(new Date())!,
    agreementVersions,
    comparison: comparison ? { runId: comparison.run.id, createdAt: comparison.run.createdAt, approvalState: comparison.run.approvalState, output: comparison.output } : undefined,
    canCompare
  };
}

export async function generateFranchiseBriefing(actor: AssistantActor, franchiseId: string) {
  const panel = await readFranchisePanel(actor, franchiseId);
  return runAssistant(actor, franchiseBriefingTask, { facts: panel.facts, today: panel.today }, { type: "franchise", id: franchiseId });
}

/** Head Office only. Two versions of agreement wording go in; a list of differences comes out for a reviewer. */
export async function generateAgreementComparison(actor: AssistantActor, franchiseId: string, input: { fromVersionId: string; toVersionId: string }) {
  const panel = await readFranchisePanel(actor, franchiseId); // proves the actor may see this franchise
  if (!panel.canCompare) throw new Error("Comparing agreement versions is a Head Office task.");
  if (input.fromVersionId === input.toVersionId) throw new Error("Choose two different versions to compare.");

  const { db, sql } = createDb();
  try {
    const data = await loadFranchiseData(db);
    const find = (id: string) => (data.agreementVersions ?? []).find((version) => version.id === id && !version.deletedAt);
    const from = find(input.fromVersionId);
    const to = find(input.toVersionId);
    if (!from || !to) throw new Error("One of those agreement versions was not found.");
    const label = (version: NonNullable<typeof from>) => `${(data.agreementTemplates ?? []).find((template) => template.id === version.templateId)?.name ?? "Agreement"} v${version.version}`;
    const diff = diffAgreementContent(from.content, to.content);
    return runAssistant(actor, agreementComparisonTask, { fromLabel: label(from), toLabel: label(to), changes: diff.changes, truncated: diff.truncated, mergeFieldsBefore: from.controlledMergeFields, mergeFieldsAfter: to.controlledMergeFields }, compareSubject(franchiseId));
  } finally {
    await sql.end();
  }
}
