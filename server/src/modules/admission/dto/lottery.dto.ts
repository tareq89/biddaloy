import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

export class LotteryDrawResponseDto {
  @ApiProperty() drawn: number;
}

export class LotteryImportValidateResponseDto {
  @ApiProperty({ type: String, nullable: true, description: 'null when the file has errors' })
  staging_id: string | null;
  @ApiProperty({ type: String, nullable: true }) expires_at: string | null;
  @ApiProperty() rows: number;
  @ApiProperty({ type: [BulkImportErrorDto] }) errors: BulkImportErrorDto[];
}

export class CommitLotteryImportDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'staging_id must be a valid id' })
  @IsNotEmpty({ message: 'Missing required field: staging_id' })
  staging_id: string;
}

export class LotteryImportCommitResponseDto {
  @ApiProperty() imported: number;
}
