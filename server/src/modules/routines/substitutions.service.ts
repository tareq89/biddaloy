import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { Routine } from './entities/routine.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { UpsertSubstitutionDto, QuerySubstitutionsDto } from './dto/substitution.dto';
import { occursOn } from './recurrence';

/**
 * [21.5.1] Substitutions CRUD (`ROUTINE_MANAGE`, enforced by the
 * controller). D12: a substitution is a dated overlay row in
 * `routine_substitutions` — it never writes to `routine_slots`. One row
 * per `(routine_slot_id, date)`; recording a second one for the same pair
 * corrects the first row in place rather than creating a duplicate.
 */
@Injectable()
export class SubstitutionsService {
  constructor(
    @InjectRepository(RoutineSubstitution)
    private readonly substitutionRepo: Repository<RoutineSubstitution>,
    @InjectRepository(RoutineSlot) private readonly slotRepo: Repository<RoutineSlot>,
    @InjectRepository(Routine) private readonly routineRepo: Repository<Routine>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
  ) {}

  async record(
    dto: UpsertSubstitutionDto,
    tenantId: string,
    userId: string,
  ): Promise<RoutineSubstitution> {
    const slot = await this.slotRepo.findOne({
      where: { id: dto.routine_slot_id, tenant_id: tenantId },
    });
    if (!slot) {
      throw new NotFoundException(`Routine slot with ID "${dto.routine_slot_id}" not found`);
    }

    await this.assertSlotOccursOn(slot, dto.date, tenantId);

    const existing = await this.substitutionRepo.findOne({
      where: { routine_slot_id: dto.routine_slot_id, date: dto.date, tenant_id: tenantId },
    });

    const values = {
      routine_slot_id: dto.routine_slot_id,
      tenant_id: tenantId,
      date: dto.date,
      substitute_teacher_id: dto.substitute_teacher_id ?? null,
      is_cancelled: dto.is_cancelled ?? false,
      reason: dto.reason ?? null,
      created_by: userId,
    };

    if (existing) {
      await this.substitutionRepo.update({ id: existing.id }, values);
      return (await this.substitutionRepo.findOne({ where: { id: existing.id } }))!;
    }

    return this.substitutionRepo.save(this.substitutionRepo.create(values));
  }

  async list(query: QuerySubstitutionsDto, tenantId: string): Promise<RoutineSubstitution[]> {
    const qb = this.substitutionRepo
      .createQueryBuilder('sub')
      .innerJoin('sub.routine_slot', 'slot')
      .where('sub.tenant_id = :tenantId', { tenantId });

    if (query.from) qb.andWhere('sub.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('sub.date <= :to', { to: query.to });
    if (query.substitute_teacher_id) {
      qb.andWhere('sub.substitute_teacher_id = :subTeacher', {
        subTeacher: query.substitute_teacher_id,
      });
    }
    if (query.section_id) {
      qb.andWhere('slot.section_id = :sectionId', { sectionId: query.section_id });
    }
    if (query.covered_for_teacher_id) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM routine_slot_teachers rst WHERE rst.routine_slot_id = slot.id AND rst.teacher_id = :coveredFor)',
        { coveredFor: query.covered_for_teacher_id },
      );
    }

    return qb.orderBy('sub.date', 'DESC').getMany();
  }

  /** Refuse a substitution on a date the slot doesn't actually occur on —
   * a sign the caller has the wrong slot. */
  private async assertSlotOccursOn(slot: RoutineSlot, date: string, tenantId: string) {
    const validTo = slot.valid_to ?? '9999-12-31';
    const routine = await this.routineRepo.findOne({
      where: { id: slot.routine_id, tenant_id: tenantId },
    });
    const academicYear = routine
      ? await this.yearRepo.findOne({
          where: { id: routine.academic_year_id, tenant_id: tenantId },
        })
      : null;

    const inRange = date >= slot.valid_from && date <= validTo;
    const matchesRecurrence =
      academicYear && occursOn(slot, date, academicYear.start_date as unknown as string);

    if (!inRange || !matchesRecurrence) {
      throw new UnprocessableEntityException(`Routine slot "${slot.id}" does not occur on ${date}`);
    }
  }
}
