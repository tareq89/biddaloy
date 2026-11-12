import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';

export class ArchiveSchoolDto {
  @ApiProperty({ description: 'A finished export of this school.' })
  @IsUUID()
  exportJobId: string;

  /** Stored as "Archived: <reason>", which must stay within the 500-char status reason. */
  @ApiProperty({ minLength: 5, maxLength: 490 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 490)
  reason: string;
}

export class StartArchiveExportResponseDto {
  @ApiProperty() jobId: string;
}

export class ArchiveExportStatusDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DELETED'] }) status: string;
  /** bigint column: a string, never Number(). */
  @ApiProperty({ nullable: true, type: String }) sizeBytes: string | null;
  @ApiProperty() pinned: boolean;
  @ApiProperty({ nullable: true, type: String }) error: string | null;
  @ApiProperty({ nullable: true, type: String }) expiresAt: string | null;
  @ApiProperty({ nullable: true, type: String }) finishedAt: string | null;
}

export class ArchiveSchoolResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['SUSPENDED'] }) status: 'SUSPENDED';
  @ApiProperty() exportJobId: string;
}
