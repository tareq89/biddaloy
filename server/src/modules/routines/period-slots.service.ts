import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import {
  PeriodSlotItemDto,
  ReplacePeriodSlotsDto,
  ChangeoverSuggestionQueryDto,
} from './dto/setup.dto';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** [21.3.1] Period slots are edited as a whole set per shift, in one
 * transaction — not row by row (Step 3 of the plan).
 *
 * Step 5's invariant — a `kind: BREAK` slot must never be referenced by a
 * `RoutineSlot` (no subject/teacher on a break) — is documented here but
 * enforced in 21.4.1, where `RoutineSlot` rows first get written; nothing
 * in this ticket can violate it since `RoutineSlot` doesn't exist yet. */
@Injectable()
export class PeriodSlotsService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(PeriodSlot)
    private readonly repo: Repository<PeriodSlot>,
    @InjectRepository(RoutineSlot)
    private readonly routineSlotRepo: Repository<RoutineSlot>,
    private readonly settingsReader: SchoolSettingsReader,
  ) {}

  async findForShift(shiftId: string, tenantId: string): Promise<PeriodSlot[]> {
    await this.getShift(shiftId, tenantId);
    return this.repo.find({
      where: { shift_id: shiftId, tenant_id: tenantId },
      order: { sequence: 'ASC' },
    });
  }

  async replaceForShift(
    shiftId: string,
    dto: ReplacePeriodSlotsDto,
    tenantId: string,
  ): Promise<PeriodSlot[]> {
    return this.repo.manager.transaction(async (manager) => {
      const shiftRepo = manager.getRepository(Shift);
      const repo = manager.getRepository(PeriodSlot);

      // Lock the shift row for the whole operation — `ShiftsService.remove`
      // locks the same row before its own reference check, so the two
      // can't interleave (one validating against a state the other is
      // about to change).
      const shift = await shiftRepo.findOne({
        where: { id: shiftId, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!shift) {
        throw new NotFoundException(`Shift with ID "${shiftId}" not found`);
      }

      // Validate every problem once, rather than failing on the first (Step
      // 3 of the plan).
      const errors = this.validateSlots(dto.slots, shift);
      if (errors.length > 0) {
        throw new BadRequestException({ message: 'Invalid period slots', errors });
      }

      // Replacing the set deletes the old rows outright; refuse if a routine
      // slot still points at one of them rather than orphaning it silently.
      const existing = await repo.find({
        where: { shift_id: shiftId, tenant_id: tenantId },
      });
      if (existing.length > 0) {
        const referencedCount = await manager.getRepository(RoutineSlot).count({
          where: { tenant_id: tenantId, period_slot_id: In(existing.map((slot) => slot.id)) },
        });
        if (referencedCount > 0) {
          throw new ConflictException(
            `Cannot replace period slots for shift "${shiftId}": ${referencedCount} routine slot(s) still reference its existing slots. Remove them first.`,
          );
        }
      }

      await repo.delete({ shift_id: shiftId, tenant_id: tenantId });
      const entities = dto.slots.map((slot) =>
        repo.create({
          shift_id: shiftId,
          tenant_id: tenantId,
          sequence: slot.sequence,
          kind: slot.kind,
          name: slot.name ?? null,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
        }),
      );
      return repo.save(entities);
    });
  }

  /** D7 — suggests `starts_at`/`ends_at` for `periodCount` back-to-back
   * periods of `periodDurationMinutes`, starting at the shift's
   * `day_starts_at` and inserting
   * `TenantSettings.routine.defaultChangeoverMinutes` between each. The
   * client offers these; nothing here writes a `PeriodSlot` row — the
   * admin still submits final times through `replaceForShift` above,
   * possibly overwritten. */
  async suggestChangeover(
    shiftId: string,
    query: ChangeoverSuggestionQueryDto,
    tenantId: string,
  ): Promise<{ sequence: number; starts_at: string; ends_at: string }[]> {
    const shift = await this.getShift(shiftId, tenantId);
    const routineSettings = await this.settingsReader.routineSettings(tenantId);
    const changeoverMinutes = routineSettings.defaultChangeoverMinutes;
    const dayEnd = timeToMinutes(shift.day_ends_at);

    const suggestions: { sequence: number; starts_at: string; ends_at: string }[] = [];
    let cursor = timeToMinutes(shift.day_starts_at);
    for (let i = 0; i < query.periodCount; i++) {
      const starts = cursor;
      const ends = starts + query.periodDurationMinutes;
      // `minutesToTime` wraps past midnight — a suggestion that runs past
      // the shift's own window would come back looking valid and then
      // get rejected by `replaceForShift`'s day-window check. Fail here
      // instead, before wrapping hides the real problem.
      if (ends > dayEnd) {
        throw new BadRequestException(
          `Period ${i} would end at ${minutesToTime(ends)}, past the shift's day_ends_at (${shift.day_ends_at}).`,
        );
      }
      suggestions.push({
        sequence: i,
        starts_at: minutesToTime(starts),
        ends_at: minutesToTime(ends),
      });
      cursor = ends + changeoverMinutes;
    }
    return suggestions;
  }

  private async getShift(shiftId: string, tenantId: string): Promise<Shift> {
    const shift = await this.shiftRepo.findOne({
      where: { id: shiftId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!shift) {
      throw new NotFoundException(`Shift with ID "${shiftId}" not found`);
    }
    return shift;
  }

  private validateSlots(slots: PeriodSlotItemDto[], shift: Shift): string[] {
    const errors: string[] = [];

    const seenSequences = new Set<number>();
    for (const slot of slots) {
      if (seenSequences.has(slot.sequence)) {
        errors.push(`Duplicate sequence ${slot.sequence}.`);
      }
      seenSequences.add(slot.sequence);
    }

    const dayStart = timeToMinutes(shift.day_starts_at);
    const dayEnd = timeToMinutes(shift.day_ends_at);
    const sorted = [...slots].sort((a, b) => a.sequence - b.sequence);

    let previousEnd: number | null = null;
    for (const slot of sorted) {
      const starts = timeToMinutes(slot.starts_at);
      const ends = timeToMinutes(slot.ends_at);

      if (starts >= ends) {
        errors.push(`Slot ${slot.sequence}: starts_at must be before ends_at.`);
        continue;
      }
      if (starts < dayStart || ends > dayEnd) {
        errors.push(
          `Slot ${slot.sequence}: falls outside the shift's day window (${shift.day_starts_at}–${shift.day_ends_at}).`,
        );
      }
      if (previousEnd !== null && starts < previousEnd) {
        errors.push(
          `Slot ${slot.sequence}: overlaps the previous slot (starts ${slot.starts_at}, previous ends ${minutesToTime(previousEnd)}).`,
        );
      }
      previousEnd = ends;
    }

    return errors;
  }
}
