// Epic 98 (#3733): every cockpit (platform owner) DTO type, in one place.

/**
 * Dev-only TOTP secret so the dev seed and the e2e helper agree.
 * Public and fixed on purpose. It is never a real secret.
 */
export const DEV_COCKPIT_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

/** Each step answer carries the short-lived token the next step sends back. */
export type CockpitLoginResponse =
  | { step: 'mfa'; mfaToken: string }
  | { step: 'enrol'; enrolToken: string }
  | { step: 'device'; deviceToken: string }
  | { step: 'done'; access_token: string };

export interface CockpitMfaRequest {
  mfaToken: string;
  /** Authenticator code (6 digits) or a recovery code. */
  code: string;
}

/** A new device needs BOTH codes: one sent by SMS and one by email. */
export interface CockpitDeviceOtpRequest {
  deviceToken: string;
  smsCode: string;
  emailCode: string;
  rememberDevice?: boolean;
}

/** Enrolment step 1 needs BOTH codes too. */
export interface CockpitEnrolStartRequest {
  enrolToken: string;
  smsCode: string;
  emailCode: string;
}

export interface CockpitEnrolConfirmRequest {
  enrolToken: string;
  /** The first code from the new authenticator. */
  code: string;
  rememberDevice?: boolean;
}

export interface CockpitEnrolStartResponse {
  otpauthUri: string;
  secret: string;
}

export interface CockpitEnrolConfirmResponse {
  step: 'done';
  access_token: string;
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
