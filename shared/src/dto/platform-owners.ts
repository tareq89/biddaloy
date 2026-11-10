// Epic 98 (#3733): every cockpit (platform owner) DTO type, in one place.

/**
 * Dev-only TOTP secret so the dev seed and the e2e helper agree.
 * Public and fixed on purpose. It is never a real secret.
 */
export const DEV_COCKPIT_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

export type CockpitLoginResponse =
  { step: 'mfa' } | { step: 'enrol' } | { step: 'device' } | { step: 'done' };

export interface CockpitMfaRequest {
  code: string;
}

export interface CockpitDeviceOtpRequest {
  code: string;
}

export type CockpitEnrolStartRequest = Record<string, never>;

export interface CockpitEnrolStartResponse {
  otpauthUri: string;
  secret: string;
}

export interface CockpitEnrolConfirmResponse {
  recoveryCodes: string[];
}

export interface CockpitMfaStatusDto {
  enrolled: boolean;
  recoveryRemaining: number;
}

export type PlatformOwnerStatus = 'ACTIVE' | 'LOCKED';

export interface PlatformOwnerDto {
  userId: string;
  name: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  status: PlatformOwnerStatus;
  lockedAt: string | null;
  lockedByName: string | null;
  lastLoginAt: string | null;
  mfaEnrolled: boolean;
}

export type PlatformApprovalStatus = 'PENDING' | 'GRANTED' | 'DENIED' | 'EXPIRED';

export interface PlatformApprovalDto {
  id: string;
  scope: string;
  summary: string;
  requestedByName: string;
  status: PlatformApprovalStatus;
  createdAt: string;
  expiresAt: string;
}

export interface PlatformApprovalSettingDto {
  enabled: boolean;
}

export interface PlatformHistoryRowDto {
  id: string;
  action: string;
  actorName: string | null;
  summary: string;
  createdAt: string;
}
