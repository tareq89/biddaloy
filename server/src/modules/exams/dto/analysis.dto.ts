import { IsOptional, IsUUID } from 'class-validator';

/** [997] Shared query shape for every analysis route — all of them accept
 * an optional section filter. */
export class AnalysisQueryDto {
  @IsOptional()
  @IsUUID()
  section_id?: string;
}
