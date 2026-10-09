import { IsIn, IsOptional } from 'class-validator';
import type { TemplateLang, TemplateVariant } from '../template.constants';

export class GetTemplateDto {
  @IsOptional()
  @IsIn(['bn', 'en'])
  lang?: TemplateLang;

  /** `starter` = only the five sheets a new school needs. Default `full`. */
  @IsOptional()
  @IsIn(['full', 'starter'])
  variant?: TemplateVariant;
}
