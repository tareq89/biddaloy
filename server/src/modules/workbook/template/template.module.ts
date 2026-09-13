import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../../schools/entities/school.entity';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

/** [14.13.1] `GET /backup/template`. Standalone: only needs `School` for the
 * `_meta` sheet and the tenant's default locale, none of ExportModule's
 * queue/storage machinery. */
@Module({
  imports: [TypeOrmModule.forFeature([School])],
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}
