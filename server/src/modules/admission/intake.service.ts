import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { UpdateIntakeDto } from './dto/update-intake.dto';

export type IntakeStatus = 'OPEN' | 'CLOSED';
export type IntakeWithStatus = AdmissionIntake & { status: IntakeStatus };
export type IntakeListRow = IntakeWithStatus & {
  class_name: string | null;
  section_name: string | null;
};

function assertDateRange(openDate: string, closeDate: string): void {
  if (openDate > closeDate) {
    throw new BadRequestException('open_date must not be after close_date');
  }
}

/** Derives OPEN/CLOSED from `open_date`/`close_date` vs now — see the
 * `AdmissionIntake` entity docstring for why this isn't a stored column. */
function withStatus(intake: AdmissionIntake): IntakeWithStatus {
  const today = new Date().toISOString().slice(0, 10);
  const status: IntakeStatus =
    today >= intake.open_date && today <= intake.close_date ? 'OPEN' : 'CLOSED';
  return { ...intake, status };
}

/** [27.3] Tenant-scoped CRUD for `admission_intakes`. */
@Injectable()
export class IntakeService {
  constructor(
    @InjectRepository(AdmissionIntake) private readonly repo: Repository<AdmissionIntake>,
  ) {}

  async create(dto: CreateIntakeDto, tenantId: string): Promise<IntakeWithStatus> {
    assertDateRange(dto.open_date, dto.close_date);
    const intake = this.repo.create({ ...dto, tenant_id: tenantId });
    return withStatus(await this.repo.save(intake));
  }

  async findAll(tenantId: string): Promise<IntakeListRow[]> {
    const intakes = await this.repo.find({
      where: {
        tenant_id: tenantId,
        deleted_at: IsNull(),
        // joined rows scoped too (multi-tenancy rule)
        class_section: { tenant_id: tenantId, class: { tenant_id: tenantId } },
      },
      relations: { class_section: { class: true } },
      // a soft-deleted section/class must still name the intake; the intake's
      // own deleted_at stays filtered above
      withDeleted: true,
      order: { created_at: 'DESC' },
    });
    return intakes.map(({ class_section, ...intake }) => ({
      ...withStatus(intake as AdmissionIntake),
      class_name: class_section?.class?.name ?? null,
      section_name: class_section?.section_name ?? null,
    }));
  }

  async findOne(id: string, tenantId: string): Promise<IntakeWithStatus> {
    const intake = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!intake) throw new NotFoundException('Admission intake not found');
    return withStatus(intake);
  }

  async update(id: string, dto: UpdateIntakeDto, tenantId: string): Promise<IntakeWithStatus> {
    // findOne enforces tenant scoping before any write touches the row.
    const current = await this.findOne(id, tenantId);
    assertDateRange(dto.open_date ?? current.open_date, dto.close_date ?? current.close_date);
    await this.repo.update({ id, tenant_id: tenantId }, dto);
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
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const closeDate = yesterday;
    const openDate = current.open_date >= today ? closeDate : current.open_date;
    await this.repo.update(
      { id, tenant_id: tenantId },
      { open_date: openDate, close_date: closeDate },
    );
    return this.findOne(id, tenantId);
  }
}
