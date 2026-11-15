import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  AdmissionApplicantStatus as Status,
  AdmissionListKind,
  AdmissionListOrder,
  AuditAction,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { admissionListConflict } from '../../common/filters/known-errors';
import { AdmissionList, type ListFilter } from './entities/admission-list.entity';
import { AdmissionListMember } from './entities/admission-list-member.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { AdmissionStageService } from './admission-stage.service';
import type { ResultActor } from './admission-stage-result.service';
import {
  meritOrder,
  resolveTieBreak,
  toHundredths,
  type MeritRow,
  type TieBreakKey,
} from './admission-merit.util';
import type {
  AdmissionListsResponseDto,
  CreateMeritListDto,
  CreateWaitingListDto,
  ListActionResponseDto,
  PatchMembersDto,
} from './dto/admission-list.dto';

const MEMBERS_PAGE = 500;
const BAD_IDS = 'Some applicants are not available for this list';

interface Candidate extends MeritRow {
  quota_tags: string[];
  gender: string;
}

const kindRank = (l: { kind: string }) => (l.kind === AdmissionListKind.MERIT ? 0 : 1);
const inOrder = (a: AdmissionList, b: AdmissionList) =>
  kindRank(a) - kindRank(b) || a.sequence - b.sequence;

/**
 * [71.2.06, Epic 71 D3, D24] The merit list and the waiting lists of a round.
 *
 * Member state is not stored: it is the applicant's status (OFFERED / WAITING / EXPIRED / ADMITTED).
 * Seat rule: ADMITTED + OFFERED never exceeds the round's `seat_count`. Every write takes the round
 * lock first (`lockIntake`, same order as `admit()`), then touches lists, so parallel activations
 * and admits queue up instead of over-filling.
 *
 * Names other tickets call and that must stay stable: `activate` (#4185 auto-switch) and
 * `expireLapsedForIntake` (#4185 job; the caller holds the round lock).
 * No Idempotency-Key (Rule 25): nothing is sent or billed here; a repeat is refused by the round
 * lock plus `UQ_admission_lists_sequence`, the already-activated 409 and the already-expired no-op.
 */
@Injectable()
export class AdmissionListService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stageService: AdmissionStageService,
    private readonly schools: SchoolsService,
    private readonly auditService: AuditService,
  ) {}

  private async audit(
    manager: EntityManager,
    tenantId: string,
    actor: ResultActor,
    newValues: Record<string, unknown>,
  ) {
    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'AdmissionApplicant',
        entity_id: null,
        tenant_id: tenantId,
        performed_by_user_id: actor.userId,
        ip_address: actor.ip,
        user_agent: actor.userAgent,
        old_values: null,
        new_values: newValues,
      },
      manager,
    );
  }

  private async setStatus(
    manager: EntityManager,
    tenantId: string,
    ids: string[],
    status: string,
    onlyFrom?: string,
  ) {
    if (ids.length === 0) return;
    await manager.query(
      `UPDATE admission_applicants SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
          AND ($4::text IS NULL OR status = $4)`,
      [tenantId, ids, status, onlyFrom ?? null],
    );
  }

  /** ADMITTED and OFFERED headcount of the round (read under the round lock for writes). */
  private async seatState(
    manager: EntityManager,
    tenantId: string,
    intakeId: string,
    seatCount: number,
  ) {
    const rows = (await manager.query(
      `SELECT status, count(*)::int AS n FROM admission_applicants
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL AND status IN ($3, $4)
        GROUP BY status`,
      [tenantId, intakeId, Status.ADMITTED, Status.OFFERED],
    )) as { status: string; n: number }[];
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    const admitted = n(Status.ADMITTED);
    const offered = n(Status.OFFERED);
    return { admitted, offered, vacant: seatCount - admitted - offered };
  }

  /**
   * Applicants who can go on a list: PENDING or SHORTLISTED (so never FEE_PENDING, rejected, expired,
   * offered or waiting), not already a member of a list of this round, and, when the round has a real
   * stage, passed the last one. A LOTTERY last stage has no cut-off, so a drawn score is enough.
   * Own SQL: `eligible()` answers a different question (who sits the NEXT stage).
   */
  private async candidates(manager: EntityManager, intake: AdmissionIntake) {
    const [stage] = (await manager.query(
      `SELECT id, kind, config FROM admission_stages
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL AND kind <> 'NONE'
        ORDER BY position DESC LIMIT 1`,
      [intake.tenant_id, intake.id],
    )) as { id: string; kind: string; config: Record<string, unknown> }[];
    const rows = (await manager.query(
      `SELECT a.id AS applicant_id, a.date_of_birth::text AS date_of_birth,
              to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
              a.quota_tags, a.gender, r.score::text AS score
         FROM admission_applicants a
         LEFT JOIN admission_stage_results r
           ON r.applicant_id = a.id AND r.stage_id = $3::uuid AND r.tenant_id = $1 AND r.deleted_at IS NULL
        WHERE a.tenant_id = $1 AND a.intake_id = $2 AND a.deleted_at IS NULL
          AND a.status IN ($4, $5)
          AND ($3::uuid IS NULL OR r.passed = true
               OR ($6::boolean AND r.passed IS NULL AND r.score IS NOT NULL))
          AND NOT EXISTS (
                SELECT 1 FROM admission_list_members m
                  JOIN admission_lists l ON l.id = m.list_id AND l.deleted_at IS NULL
                 WHERE m.applicant_id = a.id AND m.deleted_at IS NULL AND l.intake_id = $2)`,
      [
        intake.tenant_id,
        intake.id,
        stage?.id ?? null,
        Status.PENDING,
        Status.SHORTLISTED,
        stage?.kind === 'LOTTERY',
      ],
    )) as {
      applicant_id: string;
      date_of_birth: string;
      created_at: string;
      quota_tags: string[] | null;
      gender: string;
      score: string | null;
    }[];
    const list: Candidate[] = rows.map((r) => ({
      applicant_id: r.applicant_id,
      date_of_birth: r.date_of_birth,
      created_at: r.created_at,
      score_hundredths: toHundredths(r.score) ?? 0,
      quota_tags: r.quota_tags ?? [],
      gender: r.gender,
    }));
    const tieBreak: readonly TieBreakKey[] = stage
      ? resolveTieBreak(stage.config)
      : ['APPLIED_AT', 'ID'];
    return { list, tieBreak };
  }

  /** Reads the list, locks its round, then re-reads the list under the lock (404 when not this tenant's). */
  private async lockedList(manager: EntityManager, listId: string, tenantId: string) {
    const repo = manager.getRepository(AdmissionList);
    const where = { id: listId, tenant_id: tenantId, deleted_at: IsNull() };
    const first = await repo.findOne({ where });
    if (!first) throw new NotFoundException('Admission list not found');
    const intake = await this.stageService.lockIntake(manager, first.intake_id, tenantId);
    const list = await repo.findOne({ where });
    if (!list) throw new NotFoundException('Admission list not found');
    return { list, intake };
  }

  private insertMembers(
    manager: EntityManager,
    tenantId: string,
    listId: string,
    applicantIds: string[],
    firstPosition = 1,
  ) {
    const repo = manager.getRepository(AdmissionListMember);
    return repo.save(
      applicantIds.map((applicant_id, i) =>
        repo.create({
          tenant_id: tenantId,
          list_id: listId,
          applicant_id,
          position: firstPosition + i,
        }),
      ),
    );
  }

  /** The merit list is created already active: its first `capacity` ranked applicants are OFFERED. */
  async createMerit(
    intakeId: string,
    dto: CreateMeritListDto,
    tenantId: string,
    actor: ResultActor,
  ): Promise<ListActionResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const intake = await this.stageService.lockIntake(manager, intakeId, tenantId);
      const repo = manager.getRepository(AdmissionList);
      const exists = await repo.count({
        where: {
          tenant_id: tenantId,
          intake_id: intakeId,
          kind: AdmissionListKind.MERIT,
          deleted_at: IsNull(),
        },
      });
      if (exists > 0) throw admissionListConflict('MERIT_LIST_EXISTS');
      const seats = await this.seatState(manager, tenantId, intakeId, intake.seat_count);
      if (dto.capacity > intake.seat_count - seats.admitted)
        throw new BadRequestException('The capacity is more than the seats still open');

      const { list: pool, tieBreak } = await this.candidates(manager, intake);
      const ranked = meritOrder(pool, tieBreak);
      if (ranked.length > 0)
        await manager.query(
          `UPDATE admission_applicants a SET merit_rank = v.rank, updated_at = now()
             FROM unnest($2::uuid[], $3::int[]) AS v(id, rank)
            WHERE a.id = v.id AND a.tenant_id = $1`,
          [tenantId, ranked.map((r) => r.applicant_id), ranked.map((r) => r.merit_rank)],
        );
      const ids = ranked.slice(0, dto.capacity).map((m) => m.applicant_id);
      const list = await repo.save(
        repo.create({
          tenant_id: tenantId,
          intake_id: intakeId,
          kind: AdmissionListKind.MERIT,
          sequence: 1,
          order_by: AdmissionListOrder.MERIT,
          active: true,
          activated_at: new Date(),
          capacity: dto.capacity,
          act_by_date: dto.act_by_date,
          filter: {},
        }),
      );
      await this.insertMembers(manager, tenantId, list.id, ids);
      await this.setStatus(manager, tenantId, ids, Status.OFFERED);
      await this.audit(manager, tenantId, actor, {
        op: 'ADMISSION_LIST_CREATED',
        list_id: list.id,
        kind: AdmissionListKind.MERIT,
        ranked: ranked.length,
        offered: ids.length,
      });
      return { id: list.id, affected: ids.length };
    });
  }

  private order(
    pool: Candidate[],
    tieBreak: readonly TieBreakKey[],
    dto: CreateWaitingListDto,
  ): Candidate[] {
    const byId = new Map(pool.map((c) => [c.applicant_id, c]));
    const back = (rows: { applicant_id: string }[]) => rows.map((r) => byId.get(r.applicant_id)!);
    switch (dto.order) {
      case AdmissionListOrder.MANUAL: {
        const ids = dto.applicant_ids ?? [];
        if (ids.some((id) => !byId.has(id))) throw new BadRequestException(BAD_IDS);
        return ids.map((id) => byId.get(id)!);
      }
      case AdmissionListOrder.FIRST_COME:
        return back(
          meritOrder(
            pool.map((c) => ({ ...c, score_hundredths: 0 })),
            ['APPLIED_AT', 'ID'],
          ),
        );
      case AdmissionListOrder.FILTER: {
        const f = dto.filter ?? {};
        const min = f.min_score === undefined ? null : toHundredths(f.min_score);
        const kept = pool.filter(
          (c) =>
            (!f.quota_tags?.length || c.quota_tags.some((t) => f.quota_tags!.includes(t))) &&
            (min === null || c.score_hundredths >= min) &&
            (!f.gender || c.gender.toUpperCase() === f.gender.toUpperCase()),
        );
        return back(meritOrder(kept, tieBreak));
      }
      default:
        return back(meritOrder(pool, tieBreak));
    }
  }

  /** A waiting list is built inactive; its members are WAITING until `activate`. */
  async createWaiting(
    intakeId: string,
    dto: CreateWaitingListDto,
    tenantId: string,
    actor: ResultActor,
  ): Promise<ListActionResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const intake = await this.stageService.lockIntake(manager, intakeId, tenantId);
      const repo = manager.getRepository(AdmissionList);
      const merit = await repo.count({
        where: {
          tenant_id: tenantId,
          intake_id: intakeId,
          kind: AdmissionListKind.MERIT,
          deleted_at: IsNull(),
        },
      });
      if (merit === 0) throw admissionListConflict('MERIT_LIST_MISSING');
      const { max } = (await repo
        .createQueryBuilder('l')
        .select('COALESCE(MAX(l.sequence), 0)', 'max')
        .where('l.tenant_id = :tenantId AND l.intake_id = :intakeId AND l.kind = :kind', {
          tenantId,
          intakeId,
          kind: AdmissionListKind.WAITING,
        })
        .andWhere('l.deleted_at IS NULL')
        .getRawOne()) as { max: number };

      const { list: pool, tieBreak } = await this.candidates(manager, intake);
      const members = this.order(pool, tieBreak, dto).slice(0, dto.capacity);
      const filter: ListFilter =
        dto.order === AdmissionListOrder.FILTER ? JSON.parse(JSON.stringify(dto.filter ?? {})) : {};
      const list = await repo.save(
        repo.create({
          tenant_id: tenantId,
          intake_id: intakeId,
          kind: AdmissionListKind.WAITING,
          sequence: Number(max) + 1,
          order_by: dto.order,
          active: false,
          activated_at: null,
          capacity: dto.capacity,
          act_by_date: dto.act_by_date,
          filter,
        }),
      );
      const ids = members.map((m) => m.applicant_id);
      await this.insertMembers(manager, tenantId, list.id, ids);
      await this.setStatus(manager, tenantId, ids, Status.WAITING);
      await this.audit(manager, tenantId, actor, {
        op: 'ADMISSION_LIST_CREATED',
        list_id: list.id,
        kind: AdmissionListKind.WAITING,
        sequence: list.sequence,
        order: dto.order,
        members: ids.length,
      });
      return { id: list.id, affected: ids.length };
    });
  }

  /**
   * Lapses the OFFERED applicants of every activated list of the round (or just `onlyListId`) whose
   * act-by date is before `today`. The caller holds the round lock (`lockIntake`). Returns how many
   * it expired; audits only when that is more than 0 so the #4185 job leaves no noise.
   */
  async expireLapsedForIntake(
    manager: EntityManager,
    intakeId: string,
    tenantId: string,
    actor: ResultActor,
    today: string,
    onlyListId?: string,
  ): Promise<number> {
    // typeorm returns [rows, affectedCount] for UPDATE ... RETURNING on pg.
    const [rows] = (await manager.query(
      `UPDATE admission_applicants a SET status = $5, updated_at = now()
         FROM admission_list_members m
         JOIN admission_lists l ON l.id = m.list_id
        WHERE m.applicant_id = a.id AND m.deleted_at IS NULL AND l.deleted_at IS NULL
          AND l.tenant_id = $1 AND l.intake_id = $2
          AND l.activated_at IS NOT NULL AND l.act_by_date < $3::date
          AND ($4::uuid IS NULL OR l.id = $4::uuid)
          AND a.tenant_id = $1 AND a.deleted_at IS NULL AND a.status = $6
        RETURNING a.id`,
      [tenantId, intakeId, today, onlyListId ?? null, Status.EXPIRED, Status.OFFERED],
    )) as [{ id: string }[], number];
    const count = rows.length;
    if (count > 0)
      await this.audit(manager, tenantId, actor, {
        op: 'ADMISSION_OFFERS_EXPIRED',
        intake_id: intakeId,
        list_id: onlyListId ?? null,
        expired: count,
      });
    return count;
  }

  /** Offers lapse for one list after its act-by date. Repeating it expires 0. */
  async expirePending(
    listId: string,
    tenantId: string,
    actor: ResultActor,
  ): Promise<ListActionResponseDto> {
    const today = await this.schools.todayFor(tenantId);
    return this.dataSource.transaction(async (manager) => {
      const { list } = await this.lockedList(manager, listId, tenantId);
      if (!list.activated_at) throw admissionListConflict('LIST_NOT_ACTIVATED');
      if (!list.act_by_date || list.act_by_date >= today)
        throw admissionListConflict('DEADLINE_NOT_PASSED');
      const count = await this.expireLapsedForIntake(
        manager,
        list.intake_id,
        tenantId,
        actor,
        today,
        list.id,
      );
      if (count === 0)
        await this.audit(manager, tenantId, actor, {
          op: 'ADMISSION_OFFERS_EXPIRED',
          intake_id: list.intake_id,
          list_id: list.id,
          expired: 0,
        });
      return { id: list.id, affected: count };
    });
  }

  /**
   * Opens the next list: lapsed offers expire first (same transaction), then the first
   * `min(capacity, vacant)` still-WAITING members are OFFERED. 409 before the previous list's
   * act-by date, with no vacant seat, or when already active.
   */
  async activate(
    listId: string,
    tenantId: string,
    actor: ResultActor,
  ): Promise<ListActionResponseDto> {
    const today = await this.schools.todayFor(tenantId);
    return this.dataSource.transaction(async (manager) => {
      const { list, intake } = await this.lockedList(manager, listId, tenantId);
      if (list.activated_at) throw admissionListConflict('LIST_ALREADY_ACTIVATED');

      const all = await manager.getRepository(AdmissionList).find({
        where: { tenant_id: tenantId, intake_id: list.intake_id, deleted_at: IsNull() },
      });
      const sorted = all.sort(inOrder);
      const previous = sorted[sorted.findIndex((l) => l.id === list.id) - 1];
      if (previous) {
        if (!previous.activated_at) throw admissionListConflict('PREVIOUS_LIST_NOT_ACTIVATED');
        if (!previous.act_by_date || previous.act_by_date >= today)
          throw admissionListConflict('PREVIOUS_DEADLINE_NOT_PASSED');
      }

      const expired = await this.expireLapsedForIntake(
        manager,
        list.intake_id,
        tenantId,
        actor,
        today,
      );
      const { vacant } = await this.seatState(manager, tenantId, list.intake_id, intake.seat_count);
      if (vacant <= 0) throw admissionListConflict('NO_SEATS_LEFT');

      const picked = (await manager.query(
        `SELECT a.id FROM admission_list_members m
           JOIN admission_applicants a ON a.id = m.applicant_id
          WHERE m.tenant_id = $1 AND m.list_id = $2 AND m.deleted_at IS NULL
            AND a.deleted_at IS NULL AND a.status = $3
          ORDER BY m.position ASC LIMIT $4`,
        [tenantId, list.id, Status.WAITING, Math.min(list.capacity, vacant)],
      )) as { id: string }[];
      const ids = picked.map((p) => p.id);
      await this.setStatus(manager, tenantId, ids, Status.OFFERED, Status.WAITING);
      await manager
        .getRepository(AdmissionList)
        .update({ id: list.id, tenant_id: tenantId }, { active: true, activated_at: new Date() });
      await this.audit(manager, tenantId, actor, {
        op: 'ADMISSION_LIST_ACTIVATED',
        list_id: list.id,
        kind: list.kind,
        sequence: list.sequence,
        offered: ids.length,
        vacant,
        expired,
      });
      return { id: list.id, affected: ids.length };
    });
  }

  /** Lists of a round with members (first 500 each), counts by applicant status and seats left. */
  async listForIntake(intakeId: string, tenantId: string): Promise<AdmissionListsResponseDto> {
    const intake = await this.dataSource
      .getRepository(AdmissionIntake)
      .findOne({ where: { id: intakeId, tenant_id: tenantId, deleted_at: IsNull() } });
    if (!intake) throw new NotFoundException('Admission intake not found');
    const lists = (
      await this.dataSource.getRepository(AdmissionList).find({
        where: { tenant_id: tenantId, intake_id: intakeId, deleted_at: IsNull() },
      })
    ).sort(inOrder);
    const members = (await this.dataSource.query(
      `SELECT * FROM (
         SELECT m.list_id, m.applicant_id, a.applicant_name, m.position, a.status,
                row_number() OVER (PARTITION BY m.list_id ORDER BY m.position) AS rn
           FROM admission_list_members m
           JOIN admission_lists l ON l.id = m.list_id AND l.deleted_at IS NULL
           JOIN admission_applicants a ON a.id = m.applicant_id AND a.deleted_at IS NULL
          WHERE m.tenant_id = $1 AND l.intake_id = $2 AND m.deleted_at IS NULL) x
        WHERE rn <= $3 ORDER BY list_id, position`,
      [tenantId, intakeId, MEMBERS_PAGE],
    )) as {
      list_id: string;
      applicant_id: string;
      applicant_name: string;
      position: number;
      status: string;
    }[];
    const counts = (await this.dataSource.query(
      `SELECT m.list_id, a.status, count(*)::int AS n
         FROM admission_list_members m
         JOIN admission_lists l ON l.id = m.list_id AND l.deleted_at IS NULL
         JOIN admission_applicants a ON a.id = m.applicant_id AND a.deleted_at IS NULL
        WHERE m.tenant_id = $1 AND l.intake_id = $2 AND m.deleted_at IS NULL
        GROUP BY m.list_id, a.status`,
      [tenantId, intakeId],
    )) as { list_id: string; status: string; n: number }[];
    const seats = await this.seatState(
      this.dataSource.manager,
      tenantId,
      intakeId,
      intake.seat_count,
    );
    return {
      seat_count: intake.seat_count,
      seats_left: Math.max(0, seats.vacant),
      lists: lists.map((l) => {
        const n = (s: string) => counts.find((c) => c.list_id === l.id && c.status === s)?.n ?? 0;
        return {
          id: l.id,
          kind: l.kind,
          sequence: l.sequence,
          order_by: l.order_by,
          capacity: l.capacity,
          act_by_date: l.act_by_date,
          activated_at: l.activated_at ? l.activated_at.toISOString() : null,
          counts: {
            OFFERED: n(Status.OFFERED),
            WAITING: n(Status.WAITING),
            ADMITTED: n(Status.ADMITTED),
            EXPIRED: n(Status.EXPIRED),
          },
          members: members
            .filter((m) => m.list_id === l.id)
            .map(({ applicant_id, applicant_name, position, status }) => ({
              applicant_id,
              applicant_name,
              position,
              status,
            })),
        };
      }),
    };
  }

  /**
   * Edits an inactive list: remove members (back to PENDING; an earlier SHORTLISTED is not tracked),
   * add candidates (appended, up to capacity), reorder (must name every member).
   */
  async patchMembers(
    listId: string,
    dto: PatchMembersDto,
    tenantId: string,
    actor: ResultActor,
  ): Promise<ListActionResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const { list, intake } = await this.lockedList(manager, listId, tenantId);
      if (list.activated_at) throw admissionListConflict('LIST_LOCKED');
      const current = (await manager.query(
        `SELECT applicant_id FROM admission_list_members
          WHERE tenant_id = $1 AND list_id = $2 AND deleted_at IS NULL ORDER BY position`,
        [tenantId, list.id],
      )) as { applicant_id: string }[];
      let ids = current.map((c) => c.applicant_id);
      const remove = dto.remove ?? [];
      const add = dto.add ?? [];
      if (remove.some((id) => !ids.includes(id)) || add.some((id) => remove.includes(id)))
        throw new BadRequestException(BAD_IDS);

      if (remove.length) {
        await manager.query(
          `UPDATE admission_list_members SET deleted_at = now(), updated_at = now()
            WHERE tenant_id = $1 AND list_id = $2 AND applicant_id = ANY($3::uuid[]) AND deleted_at IS NULL`,
          [tenantId, list.id, remove],
        );
        await this.setStatus(manager, tenantId, remove, Status.PENDING, Status.WAITING);
        ids = ids.filter((id) => !remove.includes(id));
      }
      if (add.length) {
        const { list: pool } = await this.candidates(manager, intake);
        const ok = new Set(pool.map((c) => c.applicant_id));
        if (add.some((id) => !ok.has(id)) || ids.length + add.length > list.capacity)
          throw new BadRequestException(BAD_IDS);
        await this.insertMembers(manager, tenantId, list.id, add, ids.length + 1);
        await this.setStatus(manager, tenantId, add, Status.WAITING);
        ids = [...ids, ...add];
      }
      if (dto.order) {
        if (dto.order.length !== ids.length || dto.order.some((id) => !ids.includes(id)))
          throw new BadRequestException(BAD_IDS);
        ids = dto.order;
      }
      // One pass keeps positions 1..n with no gaps after remove / add / reorder.
      await manager.query(
        `UPDATE admission_list_members m SET position = v.pos, updated_at = now()
           FROM unnest($3::uuid[], $4::int[]) AS v(applicant_id, pos)
          WHERE m.tenant_id = $1 AND m.list_id = $2 AND m.applicant_id = v.applicant_id AND m.deleted_at IS NULL`,
        [tenantId, list.id, ids, ids.map((_, i) => i + 1)],
      );
      await this.audit(manager, tenantId, actor, {
        op: 'ADMISSION_LIST_MEMBERS_CHANGED',
        list_id: list.id,
        added: add.length,
        removed: remove.length,
        reordered: Boolean(dto.order),
      });
      return { id: list.id, affected: ids.length };
    });
  }
}
