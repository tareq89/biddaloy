import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../../common/request-context.util';
import { School } from '../schools/entities/school.entity';
import { TenantSettingsCache } from '../schools/settings/tenant-settings-cache.service';
import { clearPresetSettings } from '../schools/settings/tenant-settings-merge.util';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { ExamTemplate } from '../exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../exams/entities/exam-template-component.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { countRows, RESET_BLOCKER_ENTITIES } from './preset-blockers';
import type { ResetPresetDto } from './dto/reset-preset.dto';

/** Soft-deleted in this order (children first). Every call is scoped by tenant_id. */
const SOFT_DELETED: [string, new () => object][] = [
  ['examTemplates', ExamTemplate],
  ['classSubjects', ClassSubject],
  ['classSections', ClassSection],
  ['classes', Class],
  ['gradingBands', GradingBand],
  ['gradingScales', GradingScale],
  ['subjects', Subject],
  ['academicTerms', AcademicTerm],
  ['academicYears', AcademicYear],
];

@Injectable()
export class PresetResetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly settingsCache: TenantSettingsCache,
  ) {}

  async reset(
    schoolId: string,
    performedBy: string,
    dto: ResetPresetDto,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ deleted: Record<string, number> }> {
    const deleted = await this.dataSource.transaction(async (manager) => {
      // Lock the school row FIRST so reset serialises against apply and other resets.
      const school = await manager
        .getRepository(School)
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) throw new NotFoundException('School not found');

      // Stored preset read from the LOCKED row, never the cached settings reader.
      const settings = school.settings as unknown as Record<string, unknown> | null;
      const preset = settings?.preset;
      if (!preset) throw new ConflictException({ code: 'PRESET_NOT_APPLIED' });

      const blockers = (await countRows(manager, schoolId, RESET_BLOCKER_ENTITIES)).filter(
        (c) => c.count > 0,
      );
      if (blockers.length) throw new ConflictException({ code: 'PRESET_RESET_BLOCKED', blockers });

      // Only getRepository(X).softDelete/delete by tenant_id: never remove()/save() on an
      // entity with tenant-filtered relations (TypeORM would NULL other tenants' FKs).
      const counts: Record<string, number> = {};
      // ExamTemplateComponent has no deleted_at, so it is removed for real, before its parent.
      counts.examTemplateComponents =
        (await manager.getRepository(ExamTemplateComponent).delete({ tenant_id: schoolId }))
          .affected ?? 0;
      for (const [key, entity] of SOFT_DELETED) {
        // deleted_at IS NULL keeps the timestamps of rows that were already soft-deleted.
        counts[key] =
          (
            await manager
              .getRepository(entity)
              .softDelete({ tenant_id: schoolId, deleted_at: IsNull() } as never)
          ).affected ?? 0;
      }

      await manager
        .getRepository(School)
        .update({ id: schoolId }, { settings: clearPresetSettings(settings) as never });

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'CurriculumPreset',
          entity_id: schoolId, // audit_logs.entity_id is a uuid; the pack id lives in old_values
          tenant_id: schoolId,
          performed_by_user_id: performedBy,
          old_values: { preset, counts },
          new_values: { reason: dto.reason },
          ip_address: context.ip,
          user_agent: context.userAgent,
        },
        manager,
      );
      return counts;
    });

    // After commit only: a rolled-back reset must not evict a still-valid cache entry.
    this.settingsCache.invalidate(schoolId);
    return { deleted };
  }
}
