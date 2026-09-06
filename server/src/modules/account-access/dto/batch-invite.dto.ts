import { IsArray, IsBoolean, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';
import { MAX_BATCH_INVITE_SELECTION } from '../invitation-batch.constants';

/**
 * Selector for a batch of guardians to invite (12.6). Exactly one of
 * `guardian_ids`, `student_ids`, `all` must be supplied — enforced in
 * `GuardianProvisioningService`, not here, because "exactly one" needs a
 * clearer 400 message than a generic class-validator constraint gives.
 */
export class BatchInviteDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_INVITE_SELECTION)
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_INVITE_SELECTION)
  @IsUUID('4', { each: true })
  student_ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export interface InvitePreviewEntryDto {
  guardian_id: string;
  full_name: string;
  channel: 'SMS' | 'EMAIL';
  user_exists: boolean;
}

export type InviteSkipReason =
  'no_contact' | 'already_active' | 'already_pending' | 'notifications_disabled';

export interface InviteSkippedEntryDto {
  guardian_id: string;
  full_name: string;
  reason: InviteSkipReason;
}

export interface InvitePreviewResponseDto {
  total: number;
  to_invite: InvitePreviewEntryDto[];
  skipped: InviteSkippedEntryDto[];
}

export interface InviteDispatchResponseDto {
  batch_id: string;
  queued: number;
  skipped: InviteSkippedEntryDto[];
}

export interface InviteBatchStatusResponseDto {
  batch_id: string;
  total: number;
  sent: number;
  failed: number;
  queued: number;
}
