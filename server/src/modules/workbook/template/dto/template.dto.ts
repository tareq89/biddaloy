import { IsIn, IsOptional } from 'class-validator';
import type { TemplateLang } from '../template.constants';

export class GetTemplateDto {
  @IsOptional()
  @IsIn(['bn', 'en'])
  lang?: TemplateLang;
}
