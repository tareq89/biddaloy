// [99.1.01] Epic 99: every Login as / school-control DTO type, named once here.
import type { UserRole } from '../enums/index';
import type { JwtPayload } from '../types/auth.types';
import type {
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  ImpersonationStatus,
  SupportAccessMode,
} from '../enums/support-access';

/** A new consent text bumps this and re-asks every school (D16). */
export const SUPPORT_ACCESS_TEXT_VERSION = 1;

/** D55: the reason for a Login as start is 10 to 500 characters. */
export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 500;

/** The Redis value for a live session and the `JwtStrategy` result. */
export interface ImpersonationLiveSession {
  adminId: string;
  userId: string;
  schoolId: string;
  role: UserRole;
  viewOnly: boolean;
  writeLocked: boolean;
  kind: ImpersonationEntryKind;
}

export type ImpersonatedJwtPayload = JwtPayload & { impSession: ImpersonationLiveSession };

export interface LoginAsCandidateDto {
  /** null for a student or parent with no login account (`NO_LOGIN_ACCOUNT`). */
  userId: string | null;
  name: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
  /** D55: null when the person can be chosen; otherwise why not (the screen translates it). */
  unavailableReason: 'NO_LOGIN_ACCOUNT' | 'INACTIVE' | null;
}

export interface LoginAsCandidatesResponse {
  candidates: LoginAsCandidateDto[];
  noActiveAdmin: boolean;
  schoolStatus: 'ACTIVE' | 'SUSPENDED';
  supportAccessMode: SupportAccessMode;
}

/** `POST /platform/impersonation`. The `platform.login_as` approval token goes in `X-Approval-Token`. */
export interface StartImpersonationRequest {
  schoolId: string;
  role: UserRole;
  targetUserId: string;
  reason: string;
  viewOnly: boolean;
  /** An approved `ask` request to redeem (single use). */
  ticketId?: string;
}

/** `POST /platform/impersonation/:id/request-write`: the owner of an emergency session asks to write. */
export interface RequestWriteRequest {
  reason: string;
}

/** `code` and `expiresAt` are present only when the session is already ACTIVE. */
export interface StartImpersonationResponse {
  id: string;
  status: ImpersonationStatus;
  /** One-time exchange code. */
  code?: string;
  expiresAt?: string;
}

export interface ImpersonationSessionDto {
  id: string;
  schoolId: string;
  schoolName: string;
  platformAdminId: string;
  platformAdminName: string;
  userId: string;
  userName: string;
  role: UserRole;
  status: ImpersonationStatus;
  kind: ImpersonationEntryKind;
  viewOnly: boolean;
  reason: string;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  endedBy: ImpersonationEndedBy | null;
  expiresAt: string | null;
}

export interface ImpersonationExchangeResponse {
  access_token: string;
  sessionId: string;
  expiresAt: string;
}

export interface ImpersonationMeResponse {
  sessionId: string;
  adminName: string;
  userName: string;
  role: UserRole;
  viewOnly: boolean;
  writeLocked: boolean;
  expiresAt: string;
}

export interface SupportAccessSettingsDto {
  mode: SupportAccessMode;
  confirmedAt: string | null;
  confirmedByName: string | null;
  textVersion: number;
  currentTextVersion: number;
  /** True until an admin has ticked the box for the current text version. */
  needsConfirmation: boolean;
}

export interface SupportRequestDto {
  id: string;
  sessionId: string;
  platformAdminName: string;
  userName: string;
  role: UserRole;
  reason: string;
  status: ImpersonationStatus;
  requestedAt: string;
}

export interface SchoolSupportSessionDto {
  id: string;
  platformAdminName: string;
  userName: string;
  role: UserRole;
  status: ImpersonationStatus;
  kind: ImpersonationEntryKind;
  viewOnly: boolean;
  startedAt: string | null;
  endedAt: string | null;
  endedBy: ImpersonationEndedBy | null;
}

export interface SchoolOverviewDto {
  id: string;
  name: string;
  status: string;
  supportMode: SupportAccessMode;
  userCount: number;
  studentCount: number;
  activeSessions: number;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface SchoolNoteDto {
  id: string;
  schoolId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface PlatformUserSearchDto {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  schoolId: string;
  schoolName: string;
  role: UserRole;
  status: string;
}

export interface PlatformAuditRowDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  schoolId: string | null;
  schoolName: string | null;
  createdAt: string;
}

export interface QueueStateDto {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface SystemCardDto {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  detail: string | null;
  checkedAt: string;
}

export interface AnnouncementRequest {
  title: string;
  body: string;
  /** Empty or absent means every school. */
  schoolIds?: string[];
  approvalToken?: string;
}

export interface AnnouncementPreview {
  schoolCount: number;
  recipientCount: number;
  title: string;
  body: string;
}

export interface AnnouncementResponse {
  id: string;
  schoolCount: number;
  recipientCount: number;
  sentAt: string;
}
