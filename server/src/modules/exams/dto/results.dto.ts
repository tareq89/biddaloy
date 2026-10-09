import { IsBoolean, IsOptional, IsUUID, IsNotEmpty } from 'class-validator';

export class ProcessExamDto {
  /** Overrides the DRAFT-grid refusal (issue step 4). Forcing is always
   * audited with `forced: true` — see `ResultsService.process`. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class SendResultSmsDto {
  @IsNotEmpty()
  @IsUUID()
  exam_id: string;
}
