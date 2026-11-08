export type SystemRole = 'ADMIN' | 'SECRETARY' | 'USER';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'BLOCKED';
export type OrganizationStatus = 'CANDIDATE' | 'MEMBER' | 'PARTNER' | 'SUSPENDED' | 'EXITED' | 'APPLICANT' | 'REJECTED' | 'EXPELLED';
export type OrganizationKind = 'ORGANIZATION' | 'INDIVIDUAL';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  systemRole: SystemRole;
  canViewAll: boolean;
  isDemo: boolean;
  boardGroupId: string | null;
  organization: { id: string; name: string; shortName: string | null; status: OrganizationStatus; kind: OrganizationKind; regionCode: string | null } | null;
  totpEnabled: boolean;
  mfaRequired: boolean;
  mfaSetupPending: boolean;
  ledWorkingGroupIds: string[];
  permissions: string[];
}

export interface Region {
  code: string;
  name: string;
  federalDistrict: string;
}

export interface Organization {
  id: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  name: string;
  shortName: string | null;
  altName?: string | null;
  isDemo?: boolean;
  regionCode: string | null;
  region?: { code: string; name: string } | null;
  city: string | null;
  activityAreas: string[];
  description: string | null;
  website: string | null;
  logoFileId: string | null;
  joinedAt: string | null;
  showOnMap: boolean;
  contactPrivacy?: { hideEmail?: boolean; hidePhone?: boolean };
  fullAccess: boolean;
  // контакты (если есть право)
  email?: string | null;
  phone?: string | null;
  headName?: string | null;
  headPosition?: string | null;
  // реквизиты (своя организация / «видят всё»)
  inn?: string | null;
  ogrn?: string | null;
  kpp?: string | null;
  legalAddress?: string | null;
  postalAddress?: string | null;
}

export interface OrganizationNote {
  id: string;
  kind: 'COMMENT' | 'BOARD_DECISION';
  body: string;
  createdAt: string;
  author: { id: string; fullName: string } | null;
}

export interface OrganizationNotes {
  notes: OrganizationNote[];
  rejectedMatches: { id: string; name: string; shortName: string | null; status: OrganizationStatus }[];
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: OrganizationStatus | null;
  toStatus: OrganizationStatus;
  reason: string | null;
  changedAt: string;
  changedBy: { id: string; fullName: string } | null;
}

export interface ResponsibilityArea {
  id: string;
  code: string;
  name: string;
}

export interface Employee {
  id: string;
  organizationId: string;
  fullName: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  vk: string | null;
  telegram: string | null;
  allianceTags: string[];
  isPrimary: boolean;
  notes: string | null;
  pdConsentAt: string | null;
  user?: { id: string; email: string; status: UserStatus } | null;
  contactPrivacy?: { hideEmail?: boolean; hidePhone?: boolean; hideMessengers?: boolean; hideFromDirectory?: boolean };
  responsibilities: Array<{ id: string; area: ResponsibilityArea; workingGroup: { id: string; name: string } | null }>;
}

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  systemRole: SystemRole;
  canViewAll: boolean;
  status: UserStatus;
  organizationId: string | null;
  organization: { id: string; name: string; shortName: string | null; status: OrganizationStatus } | null;
  totpEnabledAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export type VoteScenario = 'DOCUMENT_APPROVAL' | 'EVENT_PARTICIPATION' | 'ADMISSION' | 'ELECTION' | 'OTHER';
export type VoteStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type VoteEligibility = 'ALL_MEMBERS' | 'LIST' | 'PAID_DUES';
export type QuestionFormat = 'YES_NO_ABSTAIN' | 'SINGLE' | 'MULTIPLE' | 'RANKING';

export interface VoteListItem {
  isDemo?: boolean;
  id: string;
  number: number;
  title: string;
  scenario: VoteScenario;
  status: VoteStatus;
  startsAt: string | null;
  endsAt: string;
  closedAt: string | null;
  eligibility: VoteEligibility;
  quorumPercent: number;
  createdBy: { id: string; fullName: string };
  subjectOrganization: { id: string; name: string; shortName: string | null } | null;
  eligibleCount: number;
  participatedCount: number;
  myVotedAt: string | null;
  canVote: boolean;
  quorumReached: boolean | null;
}

export interface VoteQuestion {
  id: string;
  position: number;
  text: string;
  format: QuestionFormat;
  minChoices: number;
  maxChoices: number;
  options: Array<{ id: string; position: number; text: string }>;
}

export interface OptionResult {
  optionId: string;
  text: string;
  count: number;
  percent: number;
  score?: number;
}

export interface QuestionResult {
  questionId: string;
  text: string;
  format: QuestionFormat;
  answeredCount: number;
  options: OptionResult[];
  outcome: { kind: 'ACCEPTED' | 'REJECTED' | 'WINNER' | 'TIE' | 'NO_VOTES' | 'NO_QUORUM' | 'RANKED'; label: string; winnerOptionIds: string[] };
}

export interface VoteResult {
  eligibleCount: number;
  participatedCount: number;
  turnoutPercent: number;
  quorumPercent: number;
  quorumReached: boolean;
  questions: QuestionResult[];
  computedAt: string;
}

export type AnswerMap = Record<string, Array<{ optionId: string; text: string; rank: number | null }>>;

export interface FileMeta {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface VoteDetail extends Omit<VoteListItem, 'eligibleCount' | 'participatedCount' | 'myVotedAt' | 'quorumReached'> {
  description: string | null;
  reminders: Array<{ beforeHours: number }>;
  protocolFileId: string | null;
  subjectOrganization: { id: string; name: string; shortName: string | null; status: OrganizationStatus } | null;
  questions: VoteQuestion[];
  result: VoteResult;
  rows: Array<{
    organizationId: string;
    organizationName: string;
    regionName: string;
    votedAt: string | null;
    votedBy: { id: string; fullName: string } | null;
    answers: AnswerMap;
  }>;
  attachments: FileMeta[];
  eligibleOrganizationIds: string[];
  my: { votedAt: string | null; votedBy: { id: string; fullName: string } | null; answers: AnswerMap } | null;
  cannotVoteReason: string | null;
  canManage: boolean;
}

export type DuesStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'WAIVED';
export type AgreementStatus = 'DRAFT' | 'SIGNED' | 'TERMINATED';

export interface DuesSettings {
  year: number;
  amount: string;
  dueDate: string;
  graceDays: number;
  votingRequiresPaid: boolean;
}

export interface DocMeta extends FileMeta {
  docType: string | null;
  uploadedBy?: { id: string; fullName: string } | null;
}

export interface DuesRow {
  id: string;
  organizationId: string;
  year: number;
  amountDue: number;
  paid: number;
  debt: number;
  dueDate: string;
  status: DuesStatus;
  note: string | null;
  lastPaidAt: string | null;
  documentsCount: number;
  organization: { id: string; name: string; shortName: string | null; status: OrganizationStatus; region?: { name: string } };
}

export interface DuesPayment {
  id: string;
  amount: number;
  paidAt: string;
  documentNumber: string | null;
  recordedBy: { id: string; fullName: string } | null;
}

export interface DuesDetail extends DuesRow {
  settings: DuesSettings;
  payments: DuesPayment[];
  documents: DocMeta[];
}

export interface DuesSummary {
  year: number;
  settings: DuesSettings | null;
  counts: Record<DuesStatus, number>;
  accrued: number;
  notAccrued: number;
  totalDue: number;
  totalPaid: number;
  totalDebt: number;
}

export interface Agreement {
  id: string;
  organizationId: string;
  number: string;
  year: number;
  signedAt: string | null;
  amount: number | null;
  status: AgreementStatus;
  organization?: { id: string; name: string; shortName: string | null };
  documents: DocMeta[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}

export type EventType = 'GENERAL_MEETING' | 'CONFERENCE' | 'WORKING_GROUP_MEETING' | 'OTHER';
export type EventFormat = 'OFFLINE' | 'ONLINE' | 'HYBRID';
export type EventStatus = 'PLANNED' | 'HELD' | 'CANCELLED';
export type RegistrationStatus = 'INVITED' | 'CONFIRMED_OFFLINE' | 'CONFIRMED_ONLINE' | 'DECLINED';
export type PresenceStatus = 'UNKNOWN' | 'PRESENT_OFFLINE' | 'PRESENT_ONLINE' | 'ABSENT';
export type ProtocolStatus = 'DRAFT' | 'PUBLISHED';

export type EventAudience = 'ALL_MEMBERS' | 'BOARD' | 'CANDIDATES';

export interface EventBase {
  isDemo?: boolean;
  audience: EventAudience;
  id: string;
  title: string;
  description: string | null;
  type: EventType;
  format: EventFormat;
  status: EventStatus;
  location: string | null;
  onlineUrl: string | null;
  startsAt: string;
  endsAt: string | null;
  registrationDeadline: string | null;
  workingGroupId: string | null;
  visibleToPartners: boolean;
  workingGroup: { id: string; name: string } | null;
  createdBy: { id: string; fullName: string } | null;
  my: { registration: RegistrationStatus; presence: PresenceStatus } | null;
  canRegister: boolean;
}

export interface EventListItem extends EventBase {
  protocols: { id: string; number: string | null; status: ProtocolStatus }[];
  registrations: { offline: number; online: number; declined: number };
}

export interface EventParticipant {
  userId?: string;
  fullName: string;
  organization: { id: string; name: string } | string | null;
  registration: RegistrationStatus;
  presence?: PresenceStatus;
  invited?: boolean;
}

export interface EventDetail extends EventBase {
  canManage: boolean;
  summary: { invitedOrganizations: number; confirmedOffline: number; confirmedOnline: number; declined: number; presentOrganizations: number; presentPeople: number };
  participants: EventParticipant[];
  protocols: { id: string; number: string | null; title: string; status: ProtocolStatus; publishedAt: string | null }[];
}

export interface ActivityRow {
  organizationId: string;
  name: string;
  events: { invited: number; attended: number; rate: number | null };
  votes: { eligible: number; voted: number; rate: number | null };
  score: number | null;
}

export interface EventStats {
  year: number;
  totals: { eventsHeld: number; averageAttendance: number | null; votesClosed: number; averageTurnout: number | null };
  events: { id: string; title: string; startsAt: string; type: EventType; invited: number; present: number }[];
  rating: ActivityRow[];
}

export interface ProtocolListItem {
  isDemo?: boolean;
  id: string;
  number: string | null;
  title: string;
  heldAt: string;
  status: ProtocolStatus;
  publishedAt: string | null;
  visibleToPartners: boolean;
  event: { id: string; title: string; type: EventType } | null;
  workingGroup: { id: string; name: string } | null;
  author: { id: string; fullName: string } | null;
  _count: { items: number };
}

export interface ProtocolItem {
  id?: string;
  agendaText: string;
  discussion: string | null;
  decision: string | null;
  voteId: string | null;
  vote?: { id: string; number: number; title: string; status: VoteStatus; outcome: string[] | null } | null;
}

export interface ProtocolDetail extends Omit<ProtocolListItem, '_count' | 'event'> {
  eventId: string | null;
  event: { id: string; title: string; type: EventType; format: EventFormat; location: string | null; startsAt: string } | null;
  items: ProtocolItem[];
  attachments: FileMeta[];
  attendance: { invited: number; present: string[] } | null;
  canManage: boolean;
}

export type WgRole = 'LEAD' | 'MEMBER';
export type PlanStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export interface UserBrief {
  id: string;
  fullName: string;
}
export interface TaskCounters {
  open: number;
  inProgress: number;
  done: number;
  overdue: number;
}

export interface WorkingGroupListItem {
  isDemo?: boolean;
  leaderNames: string | null;
  id: string;
  name: string;
  goals: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  leads: UserBrief[];
  membersCount: number;
  myRole: WgRole | null;
  progress: number | null;
  tasks: TaskCounters;
}

export interface WgPlanItem {
  id: string;
  title: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: PlanStatus;
  responsibleUserId: string | null;
  responsible: UserBrief | null;
  tasks: TaskCounters;
}

export interface WorkingGroupDetail {
  isDemo?: boolean;
  isBoard: boolean;
  chatVk: string | null;
  chatTelegram: string | null;
  chatMax: string | null;
  leaderNames: string | null;
  id: string;
  name: string;
  goals: string | null;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  myRole: WgRole | null;
  canManage: boolean;
  fullAccess: boolean;
  canJoin: boolean;
  members: { userId: string; fullName: string; position: string | null; organization: { id: string; name: string } | null; role: WgRole; joinedAt: string; account: UserStatus }[];
  employeeMembers: { employeeId: string; fullName: string; position: string | null; organization: { id: string; name: string }; role: WgRole }[];
  plan: WgPlanItem[];
  progress: number | null;
  tasks: TaskCounters;
  upcomingEvents: { id: string; title: string; startsAt: string; format: EventFormat }[];
  publishedProtocols: number;
  files: number;
}

export interface WgTask {
  id: string;
  title: string;
  description: string | null;
  planItemId: string | null;
  planItem: { id: string; title: string } | null;
  assigneeId: string | null;
  assignee: UserBrief | null;
  createdById: string;
  createdBy: UserBrief;
  dueDate: string | null;
  status: TaskStatus;
  doneAt: string | null;
  createdAt: string;
  overdue: boolean;
  comments: number;
  canEdit: 'all' | 'status' | 'none';
}

export interface WgComment {
  id: string;
  body: string;
  createdAt: string;
  author: UserBrief;
  canDelete: boolean;
}

export interface WgActivity {
  groups: { id: string; name: string; role: WgRole; tasks: TaskCounters; myOpenTasks: number; nextEvent: { id: string; title: string; startsAt: string } | null }[];
  myTasks: { id: string; title: string; status: TaskStatus; dueDate: string | null; overdue: boolean; workingGroup: { id: string; name: string } }[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unread: number;
}
export interface NotificationPreference {
  type: string;
  label: string;
  group: string;
  emailAvailable: boolean;
  inApp: boolean;
  email: boolean;
}
