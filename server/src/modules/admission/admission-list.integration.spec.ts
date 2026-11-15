import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AdmissionStage } from './entities/admission-stage.entity';
import { AdmissionStageService } from './admission-stage.service';
import { AdmissionListService } from './admission-list.service';

const actor = { userId: '00000000-0000-4000-8000-000000000001' };
const SEATS = 5;

/** [71.2.06] Real DB: the seat rule under parallel activations and admits. */
describe('AdmissionListService (integration)', () => {
  let ds: DataSource;
  let service: AdmissionListService;
  let stages: AdmissionStageService;
  let tenant: string;
  let intake: string;
  let people: string[];
  let today = '2026-02-01';
  const audits: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    stages = new AdmissionStageService(ds.getRepository(AdmissionStage), ds);
    const audit = {
      record: async (e: { new_values: Record<string, unknown> }) => {
        audits.push(e.new_values);
      },
    } as never;
    service = new AdmissionListService(ds, stages, { todayFor: async () => today } as never, audit);
  }, 60000);

  /** 8 applicants, scores 80..73 (a is the best). WRITTEN stage, everyone passed. */
  beforeEach(async () => {
    audits.length = 0;
    today = '2026-02-01';
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'List Int', 'list-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    tenant = id;
    const [yr] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id) VALUES ('y', '2026-01-01', '2026-12-31', false, $1) RETURNING id`,
      [id],
    );
    const [c] = await ds.query(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id) VALUES ('Six', 6, $1, $2) RETURNING id`,
      [yr.id, id],
    );
    const [s] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [c.id, id],
    );
    const [i] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'i', $3, '2026-01-01', '2026-12-31') RETURNING id`,
      [id, s.id, SEATS],
    );
    intake = i.id;
    const [st] = await ds.query(
      `INSERT INTO admission_stages (tenant_id, intake_id, position, kind, config)
       VALUES ($1, $2, 1, 'WRITTEN', '{"total_marks": 100}') RETURNING id`,
      [id, intake],
    );
    people = [];
    for (let k = 0; k < 8; k++) {
      const [a] = await ds.query(
        `INSERT INTO admission_applicants
           (tenant_id, intake_id, reference_number, applicant_name, date_of_birth, gender,
            guardian_name, guardian_phone, status, quota_tags)
         VALUES ($1, $2, $3::text, 'Kid ' || $3::text, '2015-01-01', $4, 'G', '01711000097', 'PENDING', $5::jsonb)
         RETURNING id`,
        [id, intake, `LST-${k}`, k % 2 ? 'FEMALE' : 'MALE', k < 4 ? '["FF"]' : '[]'],
      );
      people.push(a.id);
      await ds.query(
        `INSERT INTO admission_stage_results (tenant_id, stage_id, applicant_id, score, passed)
         VALUES ($1, $2, $3, $4, true)`,
        [id, st.id, a.id, (80 - k).toFixed(2)],
      );
    }
  });

  afterEach(async () => {
    for (const t of [
      'admission_list_members',
      'admission_lists',
      'admission_stage_results',
      'admission_applicants',
      'admission_stages',
      'admission_intakes',
      'class_sections',
      'classes',
      'academic_years',
    ])
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenant]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenant]);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const statusOf = async (id: string): Promise<string> =>
    (await ds.query(`SELECT status FROM admission_applicants WHERE id = $1`, [id]))[0].status;
  const count = async (status: string): Promise<number> =>
    (
      await ds.query(
        `SELECT count(*)::int AS n FROM admission_applicants WHERE intake_id = $1 AND status = $2`,
        [intake, status],
      )
    )[0].n;
  const setDeadline = (listId: string, date: string) =>
    ds.query(`UPDATE admission_lists SET act_by_date = $2 WHERE id = $1`, [listId, date]);
  /** What #4183's admit does for an offered applicant: round lock, then OFFERED -> ADMITTED. */
  const admitOffered = (applicantId: string) =>
    ds.transaction(async (manager) => {
      await stages.lockIntake(manager, intake, tenant);
      const [{ n }] = await manager.query(
        `SELECT count(*)::int AS n FROM admission_applicants WHERE intake_id = $1 AND status = 'ADMITTED'`,
        [intake],
      );
      if (n >= SEATS) return false;
      const res = await manager.query(
        `UPDATE admission_applicants SET status = 'ADMITTED' WHERE id = $1 AND status = 'OFFERED' RETURNING id`,
        [applicantId],
      );
      return res[0].length > 0;
    });
  const expectInvariant = async () => {
    expect((await count('ADMITTED')) + (await count('OFFERED'))).toBeLessThanOrEqual(SEATS);
  };
  const code = (r: PromiseRejectedResult) => r.reason.getResponse().details?.code;

  it('merit list: ranks everyone, offers the top capacity, tie-break by date of birth', async () => {
    // a and b tie on score; the older child ranks first.
    await ds.query(`UPDATE admission_stage_results SET score = 80.00 WHERE applicant_id = $1`, [
      people[1],
    ]);
    await ds.query(`UPDATE admission_applicants SET date_of_birth = '2014-01-01' WHERE id = $1`, [
      people[1],
    ]);
    const res = await service.createMerit(
      intake,
      { capacity: 3, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    expect(res.affected).toBe(3);
    const ranks = await ds.query(
      `SELECT id, merit_rank FROM admission_applicants WHERE intake_id = $1 ORDER BY merit_rank`,
      [intake],
    );
    expect(ranks).toHaveLength(8);
    expect(ranks[0].id).toBe(people[1]);
    expect(ranks[1].id).toBe(people[0]);
    expect(await count('OFFERED')).toBe(3);
    const [list] = await ds.query(`SELECT * FROM admission_lists WHERE id = $1`, [res.id]);
    expect(list).toMatchObject({ kind: 'MERIT', capacity: 3, active: true });
    expect(list.activated_at).not.toBeNull();
    expect(audits.map((a) => a.op)).toEqual(['ADMISSION_LIST_CREATED']);
  });

  it('capacity above the open seats is refused; a second merit list is a 409', async () => {
    await expect(
      service.createMerit(
        intake,
        { capacity: SEATS + 1, act_by_date: '2026-02-10' },
        tenant,
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await service.createMerit(intake, { capacity: 2, act_by_date: '2026-02-10' }, tenant, actor);
    await expect(
      service.createMerit(intake, { capacity: 2, act_by_date: '2026-02-10' }, tenant, actor),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('two parallel activations of one list: exactly one wins, the other is 409', async () => {
    const merit = await service.createMerit(
      intake,
      { capacity: 3, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    const wl = await service.createWaiting(
      intake,
      { capacity: 4, act_by_date: '2026-02-20', order: 'MERIT' },
      tenant,
      actor,
    );
    await setDeadline(merit.id, '2026-01-31');
    const settled = await Promise.allSettled([
      service.activate(wl.id, tenant, actor),
      service.activate(wl.id, tenant, actor),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(code(lost)).toBe('LIST_ALREADY_ACTIVATED');
    // The merit offers lapsed first, so all 4 waiting seats fit.
    expect(await count('EXPIRED')).toBe(3);
    expect(await count('OFFERED')).toBe(4);
    await expectInvariant();
    expect(audits.filter((a) => a.op === 'ADMISSION_LIST_ACTIVATED')).toHaveLength(1);
    expect(audits.filter((a) => a.op === 'ADMISSION_OFFERS_EXPIRED')).toHaveLength(1);
  });

  it('activation is refused before the previous act-by date and when no seat is vacant', async () => {
    const merit = await service.createMerit(
      intake,
      { capacity: SEATS, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    const wl = await service.createWaiting(
      intake,
      { capacity: 2, act_by_date: '2026-02-20', order: 'MERIT' },
      tenant,
      actor,
    );
    const early = await Promise.allSettled([service.activate(wl.id, tenant, actor)]);
    expect(code(early[0] as PromiseRejectedResult)).toBe('PREVIOUS_DEADLINE_NOT_PASSED');
    // Deadline reached, but every merit offer was admitted: nothing vacant.
    await setDeadline(merit.id, '2026-01-31');
    const offered = await ds.query(
      `SELECT id FROM admission_applicants WHERE intake_id = $1 AND status = 'OFFERED'`,
      [intake],
    );
    for (const o of offered) await admitOffered(o.id);
    expect(await count('ADMITTED')).toBe(SEATS);
    const full = await Promise.allSettled([service.activate(wl.id, tenant, actor)]);
    expect(code(full[0] as PromiseRejectedResult)).toBe('NO_SEATS_LEFT');
    await expectInvariant();
  });

  it('merit + WL1 + WL2 with admits racing activations: ADMITTED + OFFERED never exceeds seats', async () => {
    const merit = await service.createMerit(
      intake,
      { capacity: 3, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    const wl1 = await service.createWaiting(
      intake,
      { capacity: 3, act_by_date: '2026-02-12', order: 'MERIT' },
      tenant,
      actor,
    );
    const wl2 = await service.createWaiting(
      intake,
      { capacity: 3, act_by_date: '2026-02-14', order: 'MERIT' },
      tenant,
      actor,
    );
    const meritOffered = (
      await ds.query(
        `SELECT m.applicant_id FROM admission_list_members m WHERE m.list_id = $1 ORDER BY position`,
        [merit.id],
      )
    ).map((r: { applicant_id: string }) => r.applicant_id);
    // Two of three merit offers are admitted while WL1 is activated in the same moment.
    await setDeadline(merit.id, '2026-01-31');
    await Promise.allSettled([
      admitOffered(meritOffered[0]),
      service.activate(wl1.id, tenant, actor),
      admitOffered(meritOffered[1]),
    ]);
    await expectInvariant();
    // WL2 only after WL1's date; offers lapse and the vacant seats are re-offered.
    await setDeadline(wl1.id, '2026-01-31');
    const offeredNow = await ds.query(
      `SELECT id FROM admission_applicants WHERE intake_id = $1 AND status = 'OFFERED'`,
      [intake],
    );
    await Promise.allSettled([
      ...offeredNow.slice(0, 1).map((o: { id: string }) => admitOffered(o.id)),
      service.activate(wl2.id, tenant, actor),
      service.activate(wl2.id, tenant, actor),
    ]);
    await expectInvariant();
    expect((await count('ADMITTED')) + (await count('OFFERED'))).toBeLessThanOrEqual(SEATS);
  });

  it('expire then activate offers only the vacant seats', async () => {
    const merit = await service.createMerit(
      intake,
      { capacity: 4, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    const wl = await service.createWaiting(
      intake,
      { capacity: 4, act_by_date: '2026-02-20', order: 'MERIT' },
      tenant,
      actor,
    );
    const offered = await ds.query(
      `SELECT applicant_id AS id FROM admission_list_members WHERE list_id = $1 ORDER BY position`,
      [merit.id],
    );
    await admitOffered(offered[0].id);
    await admitOffered(offered[1].id);
    await setDeadline(merit.id, '2026-01-31');
    const res = await service.activate(wl.id, tenant, actor);
    // 2 admitted, 2 expired offers freed; vacant = 5 - 2 = 3 < capacity 4.
    expect(res.affected).toBe(3);
    expect(await count('ADMITTED')).toBe(2);
    expect(await count('EXPIRED')).toBe(2);
    expect(await count('OFFERED')).toBe(3);
    expect(await count('WAITING')).toBe(1);
    await expectInvariant();
  });

  it('expire-pending: refused before the date, then expires only OFFERED, a repeat expires 0', async () => {
    const merit = await service.createMerit(
      intake,
      { capacity: 3, act_by_date: '2026-02-10' },
      tenant,
      actor,
    );
    await expect(service.expirePending(merit.id, tenant, actor)).rejects.toMatchObject({
      status: 409,
    });
    const first = (
      await ds.query(
        `SELECT applicant_id AS id FROM admission_list_members WHERE list_id = $1 ORDER BY position LIMIT 1`,
        [merit.id],
      )
    )[0].id;
    await admitOffered(first);
    today = '2026-02-11';
    expect((await service.expirePending(merit.id, tenant, actor)).affected).toBe(2);
    expect(await statusOf(first)).toBe('ADMITTED');
    expect((await service.expirePending(merit.id, tenant, actor)).affected).toBe(0);
    const expired = audits.filter((a) => a.op === 'ADMISSION_OFFERS_EXPIRED');
    expect(expired.map((a) => a.expired)).toEqual([2, 0]);
  });

  it('waiting list orders: FIRST_COME, FILTER and MANUAL (a stranger id is 400)', async () => {
    await service.createMerit(intake, { capacity: 2, act_by_date: '2026-02-10' }, tenant, actor);
    const filtered = await service.createWaiting(
      intake,
      {
        capacity: 10,
        act_by_date: '2026-02-20',
        order: 'FILTER',
        filter: { quota_tags: ['FF'], gender: 'female', min_score: 77 },
      },
      tenant,
      actor,
    );
    // Not merit offers (a, b), quota FF (k < 4), female (odd k), score >= 77 -> only k = 3.
    const members = await ds.query(
      `SELECT applicant_id FROM admission_list_members WHERE list_id = $1`,
      [filtered.id],
    );
    expect(members.map((m: { applicant_id: string }) => m.applicant_id)).toEqual([people[3]]);
    const [list] = await ds.query(`SELECT filter, sequence FROM admission_lists WHERE id = $1`, [
      filtered.id,
    ]);
    expect(list).toMatchObject({ sequence: 1, filter: { quota_tags: ['FF'], min_score: 77 } });

    await expect(
      service.createWaiting(
        intake,
        {
          capacity: 2,
          act_by_date: '2026-02-20',
          order: 'MANUAL',
          applicant_ids: [people[0]],
        },
        tenant,
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const manual = await service.createWaiting(
      intake,
      {
        capacity: 2,
        act_by_date: '2026-02-20',
        order: 'MANUAL',
        applicant_ids: [people[7], people[6]],
      },
      tenant,
      actor,
    );
    const manualRows = await ds.query(
      `SELECT applicant_id FROM admission_list_members WHERE list_id = $1 ORDER BY position`,
      [manual.id],
    );
    expect(manualRows.map((m: { applicant_id: string }) => m.applicant_id)).toEqual([
      people[7],
      people[6],
    ]);
    const fc = await service.createWaiting(
      intake,
      { capacity: 1, act_by_date: '2026-02-20', order: 'FIRST_COME' },
      tenant,
      actor,
    );
    expect(fc.affected).toBe(1);
    const lists = await service.listForIntake(intake, tenant);
    expect(lists.lists.map((l) => `${l.kind}${l.sequence}`)).toEqual([
      'MERIT1',
      'WAITING1',
      'WAITING2',
      'WAITING3',
    ]);
  });

  it('waiting list needs a merit list first; members can be edited until activation', async () => {
    await expect(
      service.createWaiting(
        intake,
        { capacity: 2, act_by_date: '2026-02-20', order: 'MERIT' },
        tenant,
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.createMerit(intake, { capacity: 2, act_by_date: '2026-02-10' }, tenant, actor);
    const wl = await service.createWaiting(
      intake,
      { capacity: 3, act_by_date: '2026-02-20', order: 'MERIT' },
      tenant,
      actor,
    );
    const rows = async () =>
      (
        await ds.query(
          `SELECT applicant_id, position FROM admission_list_members WHERE list_id = $1 AND deleted_at IS NULL ORDER BY position`,
          [wl.id],
        )
      ).map((r: { applicant_id: string }) => r.applicant_id);
    const [m1, m2, m3] = await rows();
    await service.patchMembers(wl.id, { order: [m3, m1, m2] }, tenant, actor);
    expect(await rows()).toEqual([m3, m1, m2]);
    await expect(
      service.patchMembers(wl.id, { order: [m3, m1] }, tenant, actor),
    ).rejects.toMatchObject({ status: 400 });
    await service.patchMembers(wl.id, { remove: [m1] }, tenant, actor);
    expect(await statusOf(m1)).toBe('PENDING');
    expect(await rows()).toEqual([m3, m2]);
    await service.patchMembers(wl.id, { add: [people[7]] }, tenant, actor);
    expect(await statusOf(people[7])).toBe('WAITING');
    await expect(
      service.patchMembers(wl.id, { add: [people[0]] }, tenant, actor),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('CHECK rejects a negative capacity; the new columns exist', async () => {
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'admission_lists'
        AND column_name IN ('capacity', 'act_by_date', 'activated_at', 'filter')`,
    );
    expect(cols).toHaveLength(4);
    await expect(
      ds.query(
        `INSERT INTO admission_lists (tenant_id, intake_id, kind, sequence, order_by, capacity)
         VALUES ($1, $2, 'MERIT', 1, 'MERIT', -1)`,
        [tenant, intake],
      ),
    ).rejects.toThrow(/CHK_admission_lists_capacity/);
  });
});
