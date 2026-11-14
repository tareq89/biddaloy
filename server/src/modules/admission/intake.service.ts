import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource, EntityManager } from 'typeorm';
import { ADMISSION_TEMPLATES, AdmissionTemplateKey } from '@biddaloy/shared';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionStage } from './entities/admission-stage.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { assertYearOpen } from '../../common/utils/year-open.guard';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { UpdateIntakeDto } from './dto/update-intake.dto';
import { SchoolsService } from '../schools/schools.service';
import { addDays } from '../attendance/attendance-policy.util';

export type IntakeStatus = 'OPEN' | 'CLOSED';
export type IntakeWithStatus = AdmissionIntake & { status: IntakeStatus };
export type IntakeListRow = IntakeWithStatus & {
  class_name: string | null;
  section_name: string | null;
  /** [Epic 71] Stages in the pipeline. */
  stage_count: number;
  /** [Epic 71] Applicants per status; statuses with none are absent. */
  status_counts: Record<string, number>;
};

interface RoundTarget {
  class_id: string;
  class_section_id: string | null;
  academic_year_id: string;
}

function assertDateRange(openDate: string, closeDate: string): void {
  if (openDate > closeDate) {
    throw new BadRequestException('open_date must not be after close_date');
  }
}

/** Derives OPEN/CLOSED from `open_date`/`close_date` vs `today` (the school's
 * local date) — see the `AdmissionIntake` entity docstring for why this isn't
 * a stored column. */
function withStatus(intake: AdmissionIntake, today: string): IntakeWithStatus {
  const status: IntakeStatus =
    today >= intake.open_date && today <= intake.close_date ? 'OPEN' : 'CLOSED';
  return { ...intake, status };
}

/** [27.3] Tenant-scoped CRUD for `admission_intakes`. */
@Injectable()
export class IntakeService {
  constructor(
    @InjectRepository(AdmissionIntake) private readonly repo: Repository<AdmissionIntake>,
    private readonly schoolsService: SchoolsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Works out the class, optional legacy section and the class's year. A section wins
   * for old screens; with only `class_id` the section stays null (picked at admit time, D2). */
  private async resolveTarget(
    manager: EntityManager,
    tenantId: string,
    dto: { class_id?: string; class_section_id?: string },
  ): Promise<RoundTarget> {
    let classId = dto.class_id;
    let sectionId: string | null = null;
    if (dto.class_section_id) {
      const section = await manager
        .getRepository(ClassSection)
        .findOne({ where: { id: dto.class_section_id, tenant_id: tenantId } });
      if (!section) throw new NotFoundException('Class section not found');
      if (classId && classId !== section.class_id) {
        throw new BadRequestException('class_id does not match the class section');
      }
      classId = section.class_id;
      sectionId = section.id;
    }
    if (!classId) throw new BadRequestException('class_id is required');
    const cls = await manager
      .getRepository(Class)
      .findOne({ where: { id: classId, tenant_id: tenantId } });
    if (!cls) throw new NotFoundException('Class not found');
    return {
      class_id: cls.id,
      class_section_id: sectionId,
      academic_year_id: cls.academic_year_id,
    };
  }

  async create(dto: CreateIntakeDto, tenantId: string): Promise<IntakeWithStatus> {
    assertDateRange(dto.open_date, dto.close_date);
    const key = dto.template_key ?? AdmissionTemplateKey.APPLY_ONLY;
    const template = ADMISSION_TEMPLATES[key];
    const saved = await this.dataSource.transaction(async (manager) => {
      const target = await this.resolveTarget(manager, tenantId, dto);
      await assertYearOpen(manager, tenantId, target.academic_year_id); // Rule 28
      const intakes = manager.getRepository(AdmissionIntake);
      const intake = await intakes.save(
        intakes.create({
          ...dto,
          ...target,
          template_key: key,
          form_fields: dto.form_fields ?? template.fields,
          tenant_id: tenantId,
        }),
      );
      const stages = manager.getRepository(AdmissionStage);
      await stages.save(
        template.stages.map((st, i) =>
          stages.create({
            tenant_id: tenantId,
            intake_id: intake.id,
            position: i + 1,
            kind: st.kind,
            title: null,
            config: { list_order: st.order },
          }),
        ),
      );
      return intake;
    });
    return withStatus(saved, await this.schoolsService.todayFor(tenantId));
  }

  async findAll(tenantId: string): Promise<IntakeListRow[]> {
    const intakes = await this.repo.find({
      where: [
        // pipeline rounds have no section ([Epic 71 D2]); their class is joined below
        { tenant_id: tenantId, deleted_at: IsNull(), class_section_id: IsNull() },
        {
          tenant_id: tenantId,
          deleted_at: IsNull(),
          // joined rows scoped too (multi-tenancy rule)
          class_section: { tenant_id: tenantId, class: { tenant_id: tenantId } },
        },
      ],
      relations: { class_section: { class: true }, class: true },
      // a soft-deleted section/class must still name the intake; the intake's
      // own deleted_at stays filtered above
      withDeleted: true,
      order: { created_at: 'DESC' },
    });
    const today = await this.schoolsService.todayFor(tenantId);
    const stageRows: Array<{ intake_id: string; n: string }> = await this.repo.manager.query(
      `SELECT intake_id, COUNT(*) AS n FROM admission_stages
        WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY intake_id`,
      [tenantId],
    );
    const statusRows: Array<{ intake_id: string; status: string; n: string }> =
      await this.repo.manager.query(
        `SELECT intake_id, status, COUNT(*) AS n FROM admission_applicants
          WHERE tenant_id = $1 GROUP BY intake_id, status`,
        [tenantId],
      );
    const stageCount = new Map(stageRows.map((r) => [r.intake_id, Number(r.n)]));
    const statusCounts = new Map<string, Record<string, number>>();
    for (const r of statusRows) {
      const m = statusCounts.get(r.intake_id) ?? {};
      m[r.status] = Number(r.n);
      statusCounts.set(r.intake_id, m);
    }
    return intakes.map(({ class_section, class: cls, ...intake }) => ({
      ...withStatus(intake as AdmissionIntake, today),
      class_name: class_section?.class?.name ?? cls?.name ?? null,
      section_name: class_section?.section_name ?? null,
      stage_count: stageCount.get(intake.id) ?? 0,
      status_counts: statusCounts.get(intake.id) ?? {},
    }));
  }

  async findOne(id: string, tenantId: string): Promise<IntakeWithStatus> {
    const intake = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!intake) throw new NotFoundException('Admission intake not found');
    return withStatus(intake, await this.schoolsService.todayFor(tenantId));
  }

  async update(id: string, dto: UpdateIntakeDto, tenantId: string): Promise<IntakeWithStatus> {
    // findOne enforces tenant scoping before any write touches the row.
    const current = await this.findOne(id, tenantId);
    assertDateRange(dto.open_date ?? current.open_date, dto.close_date ?? current.close_date);
    await this.dataSource.transaction(async (manager) => {
      const { class_id, class_section_id, ...rest } = dto;
      let target: Partial<RoundTarget> = {};
      if (class_id || class_section_id) {
        target = await this.resolveTarget(manager, tenantId, { class_id, class_section_id });
        await assertYearOpen(manager, tenantId, target.academic_year_id!);
      }
      if (current.academic_year_id)
        await assertYearOpen(manager, tenantId, current.academic_year_id);
      await manager
        .getRepository(AdmissionIntake)
        .update({ id, tenant_id: tenantId }, { ...rest, ...target });
    });
    return this.findOne(id, tenantId);
  }

  /** Closes the intake immediately by pulling `close_date` back to
   * yesterday, rather than a separate stored flag — keeps status
   * derivation the one source of truth. `withStatus` treats today as still
   * OPEN when `close_date` is today, so yesterday (not today) is what
   * actually closes it right away. If `open_date` is today or later, pull
   * it back to the same date too, so the range never inverts. */
  async close(id: string, tenantId: string): Promise<IntakeWithStatus> {
    const current = await this.findOne(id, tenantId);
    const today = await this.schoolsService.todayFor(tenantId);
    const yesterday = addDays(today, -1);
    const closeDate = yesterday;
    const openDate = current.open_date >= today ? closeDate : current.open_date;
    await this.dataSource.transaction(async (manager) => {
      if (current.academic_year_id)
        await assertYearOpen(manager, tenantId, current.academic_year_id);
      await manager
        .getRepository(AdmissionIntake)
        .update({ id, tenant_id: tenantId }, { open_date: openDate, close_date: closeDate });
    });
    return this.findOne(id, tenantId);
  }
}
