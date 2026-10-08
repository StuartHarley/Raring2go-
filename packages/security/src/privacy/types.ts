export type PrivacyRequestKind = "export" | "erasure";
export type PrivacyRequestStatus = "requested" | "completed" | "rejected";

export type PrivacyRequestRecord = {
  id: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  subjectContactId: string | null;
  subjectEmailHash: string;
  requestedByUserId: string;
  requestNote: string | null;
  dueAt: Date;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  completedAt: Date | null;
  resultSummary: Record<string, unknown>;
  createdAt: Date;
};

export type NewPrivacyRequest = {
  kind: PrivacyRequestKind;
  subjectContactId: string | null;
  subjectEmailHash: string;
  requestedByUserId: string;
  requestNote: string | null;
  dueAt: Date;
};

/** Everything held about one subscriber, in a form they can be given. */
export type SubjectDataBundle = {
  generatedAt: string;
  subject: { contactId: string };
  contact: Record<string, unknown>;
  subscriptions: Array<Record<string, unknown>>;
  preferences: Record<string, unknown> | null;
  consentEvents: Array<Record<string, unknown>>;
  suppressions: Array<Record<string, unknown>>;
  savedContent: Array<Record<string, unknown>>;
  activity: Array<Record<string, unknown>>;
  segmentMemberships: Array<Record<string, unknown>>;
  emailDeliveries: Array<Record<string, unknown>>;
};

export type DataCounts = Record<string, number>;

/**
 * What the privacy service needs from storage. Each method is one unit of work; the runtime
 * runs a whole service call inside a single transaction, so a failed erasure leaves nothing
 * half-done.
 */
export type PrivacyStore = {
  findContactByEmail(emailNormalised: string): Promise<{ id: string } | undefined>;
  findOpenRequest(kind: PrivacyRequestKind, subjectEmailHash: string): Promise<PrivacyRequestRecord | undefined>;
  insertRequest(input: NewPrivacyRequest): Promise<PrivacyRequestRecord>;
  /** `forUpdate` takes a row lock for the rest of the transaction, serialising concurrent decisions. */
  getRequest(id: string, options?: { forUpdate?: boolean }): Promise<PrivacyRequestRecord | undefined>;
  listRequests(): Promise<PrivacyRequestRecord[]>;
  gatherSubjectData(contactId: string, now: Date): Promise<SubjectDataBundle>;
  /** Move a request out of `requested` exactly once; undefined if someone else already did. */
  settleRequest(id: string, input: { status: "completed" | "rejected"; decidedByUserId: string | null; decisionNote: string | null; resultSummary: Record<string, unknown> }, now: Date): Promise<PrivacyRequestRecord | undefined>;
  eraseContact(contactId: string, now: Date): Promise<DataCounts>;
};
