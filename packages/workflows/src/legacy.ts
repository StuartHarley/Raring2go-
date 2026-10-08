import {
  contentItems,
  contentWebsitePublishingJobs,
  emailCampaigns,
  emailSendJobs,
  publicationOutputs,
  socialPublications,
  socialPublishJobs,
  territoryEditions
} from "@raring2go/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { WorkflowsDb } from "./repository";
import { normaliseLegacyStatus, traceHrefFor } from "./tracked";
import type { JobSource, TrackedJob } from "./tracked";
import type { JobCounts, JobFilter } from "./types";
import { jobStatuses } from "./types";

const PER_SOURCE_LIMIT = 100;

/** Port for the domain tables that predate the generic queue. */
export type LegacyJobReader = {
  list(filter: JobFilter): Promise<TrackedJob[]>;
  get(source: Exclude<JobSource, "jobs">, id: string): Promise<TrackedJob | undefined>;
  /** Re-queues a failed email send job from its saved cursor. Returns the job or undefined if it was not failed. */
  retryEmailSend(id: string, now: Date): Promise<TrackedJob | undefined>;
  counts(filter: Pick<JobFilter, "organisationId" | "territoryId">): Promise<JobCounts>;
};

export function createDrizzleLegacyJobReader(db: WorkflowsDb): LegacyJobReader {
  async function email(filter: JobFilter, id?: string) {
    const conditions: SQL[] = [];
    if (id) conditions.push(eq(emailSendJobs.id, id));
    if (filter.territoryId) conditions.push(eq(emailCampaigns.territoryId, filter.territoryId));
    const rows = await db
      .select({ job: emailSendJobs, territoryId: emailCampaigns.territoryId, title: emailCampaigns.title })
      .from(emailSendJobs)
      .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailSendJobs.campaignId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(emailSendJobs.createdAt))
      .limit(PER_SOURCE_LIMIT);
    return rows.map(({ job, territoryId }): TrackedJob => ({
      source: "email_send",
      id: job.id,
      kind: "email.send_campaign",
      status: normaliseLegacyStatus("email_send", job.status),
      rawStatus: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      organisationId: null,
      territoryId,
      subjectType: "email_campaign",
      subjectId: job.campaignId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      traceHref: traceHrefFor("email_send", job.campaignId)
    }));
  }

  async function social(filter: JobFilter, id?: string) {
    const conditions: SQL[] = [];
    if (id) conditions.push(eq(socialPublishJobs.id, id));
    if (filter.territoryId) conditions.push(eq(socialPublications.territoryId, filter.territoryId));
    const rows = await db
      .select({ job: socialPublishJobs, territoryId: socialPublications.territoryId })
      .from(socialPublishJobs)
      .innerJoin(socialPublications, eq(socialPublications.id, socialPublishJobs.publicationId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(socialPublishJobs.createdAt))
      .limit(PER_SOURCE_LIMIT);
    return rows.map(({ job, territoryId }): TrackedJob => ({
      source: "social_publish",
      id: job.id,
      kind: "social.publish_post",
      status: normaliseLegacyStatus("social_publish", job.status),
      rawStatus: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      organisationId: null,
      territoryId,
      subjectType: "social_publication",
      subjectId: job.publicationId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      traceHref: traceHrefFor("social_publish", job.publicationId)
    }));
  }

  async function website(filter: JobFilter, id?: string) {
    const conditions: SQL[] = [];
    if (id) conditions.push(eq(contentWebsitePublishingJobs.id, id));
    if (filter.territoryId) conditions.push(eq(contentItems.territoryId, filter.territoryId));
    const rows = await db
      .select({ job: contentWebsitePublishingJobs, territoryId: contentItems.territoryId, organisationId: contentItems.organisationId })
      .from(contentWebsitePublishingJobs)
      .innerJoin(contentItems, eq(contentItems.id, contentWebsitePublishingJobs.contentItemId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(contentWebsitePublishingJobs.createdAt))
      .limit(PER_SOURCE_LIMIT);
    return rows.map(({ job, territoryId, organisationId }): TrackedJob => ({
      source: "website_publish",
      id: job.id,
      kind: "content.publish_website",
      status: normaliseLegacyStatus("website_publish", job.status),
      rawStatus: job.status,
      attempts: 0,
      maxAttempts: null,
      lastError: typeof job.providerMetadata?.error === "string" ? job.providerMetadata.error : null,
      organisationId,
      territoryId,
      subjectType: "content_item",
      subjectId: job.contentItemId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      traceHref: traceHrefFor("website_publish", job.contentItemId)
    }));
  }

  async function outputs(filter: JobFilter, id?: string) {
    const conditions: SQL[] = [ne(publicationOutputs.status, "superseded")];
    if (id) conditions.push(eq(publicationOutputs.id, id));
    if (filter.territoryId) conditions.push(eq(territoryEditions.territoryId, filter.territoryId));
    const rows = await db
      .select({ output: publicationOutputs, territoryId: territoryEditions.territoryId, organisationId: territoryEditions.franchiseOrganisationId })
      .from(publicationOutputs)
      .innerJoin(territoryEditions, eq(territoryEditions.id, publicationOutputs.territoryEditionId))
      .where(and(...conditions))
      .orderBy(desc(publicationOutputs.createdAt))
      .limit(PER_SOURCE_LIMIT);
    return rows.map(({ output, territoryId, organisationId }): TrackedJob => ({
      source: "publication_output",
      id: output.id,
      kind: `publishing.generate_${output.outputType}`,
      status: normaliseLegacyStatus("publication_output", output.status),
      rawStatus: output.status,
      attempts: 0,
      maxAttempts: null,
      lastError: typeof output.metadata?.error === "string" ? output.metadata.error : null,
      organisationId,
      territoryId,
      subjectType: "territory_edition",
      subjectId: output.territoryEditionId,
      createdAt: output.createdAt,
      updatedAt: output.updatedAt,
      traceHref: traceHrefFor("publication_output", output.territoryEditionId)
    }));
  }

  const readers: Record<Exclude<JobSource, "jobs">, (filter: JobFilter, id?: string) => Promise<TrackedJob[]>> = {
    email_send: email,
    social_publish: social,
    website_publish: website,
    publication_output: outputs
  };

  function applyFilter(jobs: TrackedJob[], filter: JobFilter) {
    return jobs
      .filter((job) => !filter.statuses || filter.statuses.length === 0 || filter.statuses.includes(job.status))
      .filter((job) => !filter.kinds || filter.kinds.length === 0 || filter.kinds.includes(job.kind))
      .filter((job) => !filter.organisationId || job.organisationId === filter.organisationId)
      .filter((job) => !filter.subjectType || job.subjectType === filter.subjectType)
      .filter((job) => !filter.subjectId || job.subjectId === filter.subjectId);
  }

  return {
    async list(filter) {
      const all = await Promise.all(Object.values(readers).map((read) => read(filter)));
      return applyFilter(all.flat(), filter);
    },

    async get(source, id) {
      return (await readers[source]({}, id))[0];
    },

    async retryEmailSend(id, now) {
      const [row] = await db
        .update(emailSendJobs)
        .set({ status: "queued", attempts: 0, nextAttemptAt: now, lastError: null, updatedAt: now })
        .where(and(eq(emailSendJobs.id, id), eq(emailSendJobs.status, "failed")))
        .returning({ id: emailSendJobs.id });
      return row ? (await readers.email_send({}, id))[0] : undefined;
    },

    async counts(filter) {
      const counts = Object.fromEntries(jobStatuses.map((status) => [status, 0])) as JobCounts;
      const territory = filter.territoryId;
      const total = sql<number>`count(*)::int`;

      const groups = await Promise.all([
        db
          .select({ raw: emailSendJobs.status, total })
          .from(emailSendJobs)
          .innerJoin(emailCampaigns, eq(emailCampaigns.id, emailSendJobs.campaignId))
          .where(territory ? eq(emailCampaigns.territoryId, territory) : undefined)
          .groupBy(emailSendJobs.status)
          .then((rows) => rows.map((row) => ({ source: "email_send" as const, ...row }))),
        db
          .select({ raw: socialPublishJobs.status, total })
          .from(socialPublishJobs)
          .innerJoin(socialPublications, eq(socialPublications.id, socialPublishJobs.publicationId))
          .where(territory ? eq(socialPublications.territoryId, territory) : undefined)
          .groupBy(socialPublishJobs.status)
          .then((rows) => rows.map((row) => ({ source: "social_publish" as const, ...row }))),
        db
          .select({ raw: contentWebsitePublishingJobs.status, total })
          .from(contentWebsitePublishingJobs)
          .innerJoin(contentItems, eq(contentItems.id, contentWebsitePublishingJobs.contentItemId))
          .where(territory ? eq(contentItems.territoryId, territory) : undefined)
          .groupBy(contentWebsitePublishingJobs.status)
          .then((rows) => rows.map((row) => ({ source: "website_publish" as const, ...row }))),
        db
          .select({ raw: publicationOutputs.status, total })
          .from(publicationOutputs)
          .innerJoin(territoryEditions, eq(territoryEditions.id, publicationOutputs.territoryEditionId))
          .where(and(ne(publicationOutputs.status, "superseded"), territory ? eq(territoryEditions.territoryId, territory) : undefined))
          .groupBy(publicationOutputs.status)
          .then((rows) => rows.map((row) => ({ source: "publication_output" as const, ...row })))
      ]);

      for (const group of groups.flat()) {
        counts[normaliseLegacyStatus(group.source, group.raw)] += group.total;
      }
      return counts;
    }
  };
}
