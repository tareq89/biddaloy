import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID, ArrayMaxSize } from 'class-validator';
import { MAX_BATCH_INVITE_SELECTION } from '../invitation-batch.constants';

/**
 * Selector for a batch of guardians to invite (12.6). Exactly one of
 * `guardian_ids`, `student_ids`, `all` must be supplied — enforced in
 * `GuardianProvisioningService`, not here, because "exactly one" needs a
 * clearer 400 message than a generic class-validator constraint gives.
 */
export class BatchInviteDto {
  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_INVITE_SELECTION)
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_INVITE_SELECTION)
  @IsUUID('4', { each: true })
  student_ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  /** Only with `all`: continue after this guardian id (keyset paging, 1000 at a time). */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  after?: string;
}

export type InviteSkipReason =
  'no_contact' | 'already_active' | 'already_pending' | 'notifications_disabled' | 'contact_in_use';

export class InvitePreviewEntryDto {
  @ApiProperty() guardian_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ enum: ['SMS', 'EMAIL'] }) channel: 'SMS' | 'EMAIL';
  @ApiProperty() user_exists: boolean;
  /** True when the processor files a join request instead of sending an invite. */
  @ApiProperty() join_request: boolean;
}

export class InviteSkippedEntryDto {
  @ApiProperty() guardian_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({
    enum: [
      'no_contact',
      'already_active',
      'already_pending',
      'notifications_disabled',
      'contact_in_use',
    ],
  })
  reason: InviteSkipReason;
}

export class InvitePreviewResponseDto {
  @ApiProperty() total: number;
  /** For `all`: id to send as `after` to get the next slice; null when none remain. */
  @ApiProperty({ type: String, nullable: true }) next_after: string | null;
  @ApiProperty({ type: [InvitePreviewEntryDto] }) to_invite: InvitePreviewEntryDto[];
  @ApiProperty({ type: [InviteSkippedEntryDto] }) skipped: InviteSkippedEntryDto[];
}

export class InviteDispatchResponseDto {
  @ApiProperty() batch_id: string;
  @ApiProperty() queued: number;
  /** For `all`: id to send as `after` for the next slice, from the slice this call sent; null when none remain. */
  @ApiProperty({ type: String, nullable: true }) next_after: string | null;
  @ApiProperty({ type: [InviteSkippedEntryDto] }) skipped: InviteSkippedEntryDto[];
}

export class InviteBatchStatusResponseDto {
  @ApiProperty() batch_id: string;
  @ApiProperty() total: number;
  @ApiProperty() sent: number;
  @ApiProperty() failed: number;
  @ApiProperty() queued: number;
  @ApiProperty() skipped: number;
}
