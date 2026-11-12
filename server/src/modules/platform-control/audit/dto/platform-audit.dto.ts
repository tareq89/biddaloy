import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditAction, ImpersonationStatus } from '@biddaloy/shared';

class PageQueryDto {
  /** Opaque; the server validates it and answers a fixed 400 if it is not one of its own. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SearchPlatformAuditQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListLoginAsSessionsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsEnum(ImpersonationStatus)
  status?: ImpersonationStatus;
}

/** Never carries old_values / new_values. */
export interface PlatformAuditItem {
  id: string;
  action: string;
  entityType: string;
  /** "Platform" when the row has no school (cockpit actions). */
  schoolName: string;
  tenantId: string | null;
  actorName: string | null;
  impersonatedByName: string | null;
  sessionId: string | null;
  at: string;
}

export interface LoginAsSessionItem {
  id: string;
  ownerId: string;
  ownerName: string;
  schoolId: string;
  schoolName: string;
  role: string;
  personName: string;
  reason: string | null;
  entryKind: string;
  startedAt: string | null;
  endedAt: string | null;
  status: ImpersonationStatus;
  changedCount: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
