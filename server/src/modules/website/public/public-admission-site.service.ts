import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ModuleKey, resolveModuleState } from '@biddaloy/shared';
import { AdmissionApplicantService } from '../../admission/admission-applicant.service';
import { AdmissionFormSchemaService } from '../../admission/admission-form-schema.service';
import { AdmissionApplicant } from '../../admission/entities/admission-applicant.entity';
import { AdmissionIntake } from '../../admission/entities/admission-intake.entity';
import { normalizeBdPhoneNumber } from '../../communications/providers/shared/phone-number.util';
import { ModuleStateReader } from '../../auth/guards/module-state.reader';
import { CheckApplicantStatusDto } from '../../admission/dto/check-applicant-status.dto';
import { PublicSiteSubmitApplicantDto } from './public-site-submit-applicant.dto';
import { PublicSiteService, siteNotFound } from './public-site.service';

/** One text for every miss of a roll + phone lookup (Rule 23): wrong roll equals wrong phone. */
export const lookupNotFound = () => new NotFoundException('Not found');

const LIST_MEMBER_CAP = 500;

export interface RollPhoneDto {
  roll_number: string;
  guardian_phone: string;
}

/**
 * [#4187] The school site's admission API. The host gives the school (`PublicSiteService.liveForWrite`);
 * nothing here reads a tenant id from a request. Reads of what a round has published go through
 * the flags #4184 sets (`stage.config.published_at`, `list.published_at`).
 */
@Injectable()
export class PublicAdmissionSiteService {
  constructor(
    private readonly site: PublicSiteService,
    private readonly applicants: AdmissionApplicantService,
    private readonly formSchema: AdmissionFormSchemaService,
    private readonly moduleState: ModuleStateReader,
    private readonly dataSource: DataSource,
    @InjectRepository(AdmissionIntake) private readonly intakes: Repository<AdmissionIntake>,
    @InjectRepository(AdmissionApplicant)
    private readonly applicantRepo: Repository<AdmissionApplicant>,
  ) {}

  /** Host -> live school; unknown host, off site and admission off all give the one site 404. */
  async school(host: string) {
    const live = await this.site.liveForWrite(host);
    const state = await this.moduleState.forTenant(live.tenantId);
    if (!resolveModuleState(state, ModuleKey.admission).on) throw siteNotFound();
    return { tenantId: live.tenantId, slug: live.school.slug };
  }

  async rounds(host: string) {
    const { tenantId, slug } = await this.school(host);
    const open = await this.applicants.listOpenIntakes(slug);
    if (open.length === 0) return [];
    const rows = await this.intakes.find({
      where: { id: In(open.map((o) => o.id)), tenant_id: tenantId, deleted_at: IsNull() },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return open.flatMap((o) => {
      const r = byId.get(o.id);
      if (!r) return [];
      return [
        {
          ...o,
          form: this.formSchema.forRound(r),
          fee_amount_paisa: r.fee_amount_paisa,
          fee_pay_methods: r.fee_pay_methods,
        },
      ];
    });
  }

  async submit(host: string, dto: PublicSiteSubmitApplicantDto, files: Express.Multer.File[]) {
    const { slug } = await this.school(host);
    // Same shape createByStaff builds: the `fee_proof` part is the proof, the rest are documents.
    const proof = files.find((f) => f.fieldname === 'fee_proof');
    return this.applicants.submit(
      slug,
      dto,
      files.filter((f) => f !== proof),
      { method: dto.fee_method, reference: dto.fee_reference?.trim(), file: proof },
    );
  }

  async status(host: string, dto: CheckApplicantStatusDto) {
    const { slug } = await this.school(host);
    return this.applicants.getStatus(slug, dto);
  }

  /** The applicant whose roll and phone both match, in this school only; else the one 404. */
  private async byRollAndPhone(tenantId: string, dto: RollPhoneDto) {
    const roll = dto.roll_number.trim();
    const rows = await this.applicantRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId AND a.deleted_at IS NULL', { tenantId })
      .andWhere('UPPER(a.roll_number) = UPPER(:roll)', { roll })
      .getMany();
    const phone = normalizeBdPhoneNumber(dto.guardian_phone);
    const hit = rows.find((a) => normalizeBdPhoneNumber(a.guardian_phone) === phone);
    if (!hit) throw lookupNotFound();
    return hit;
  }

  /** Stage outcomes and list placement the round has published; nothing else. */
  async result(host: string, dto: RollPhoneDto) {
    const { tenantId } = await this.school(host);
    const a = await this.byRollAndPhone(tenantId, dto);
    const intake = await this.intakes.findOne({ where: { id: a.intake_id, tenant_id: tenantId } });
    const stages = (await this.dataSource.query(
      `SELECT s.title, s.kind, r.passed, r.score
         FROM admission_stage_results r
         JOIN admission_stages s ON s.id = r.stage_id AND s.deleted_at IS NULL
        WHERE r.tenant_id = $1 AND r.applicant_id = $2 AND r.deleted_at IS NULL
          AND r.passed IS NOT NULL AND s.config ? 'published_at'
        ORDER BY s.position`,
      [tenantId, a.id],
    )) as { title: string | null; kind: string; passed: boolean; score: string | null }[];
    const lists = (await this.dataSource.query(
      `SELECT l.kind, l.sequence, m.position
         FROM admission_list_members m
         JOIN admission_lists l ON l.id = m.list_id AND l.deleted_at IS NULL
        WHERE m.tenant_id = $1 AND m.applicant_id = $2 AND m.deleted_at IS NULL
          AND l.published_at IS NOT NULL
        ORDER BY l.sequence`,
      [tenantId, a.id],
    )) as { kind: string; sequence: number; position: number }[];
    return {
      applicant_name: a.applicant_name,
      roll_number: a.roll_number,
      intake_title: intake?.title ?? '',
      status: a.status,
      stages: stages.map((s) => ({
        title: s.title ?? s.kind,
        outcome: s.passed ? 'PASSED' : 'NOT_PASSED',
      })),
      lists,
    };
  }

  /** Admit card data: who, which round, and the date / time / venue of each scheduled stage. */
  async admitCard(host: string, dto: RollPhoneDto) {
    const { tenantId } = await this.school(host);
    const a = await this.byRollAndPhone(tenantId, dto);
    const intake = await this.intakes.findOne({ where: { id: a.intake_id, tenant_id: tenantId } });
    const stages = (await this.dataSource.query(
      `SELECT title, kind, config->>'date' AS date, config->>'start_time' AS start_time,
              config->>'venue' AS venue
         FROM admission_stages
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL AND config ? 'date'
        ORDER BY position`,
      [tenantId, a.intake_id],
    )) as {
      title: string | null;
      kind: string;
      date: string;
      start_time: string | null;
      venue: string | null;
    }[];
    return {
      applicant_name: a.applicant_name,
      roll_number: a.roll_number,
      guardian_name: a.guardian_name,
      date_of_birth: a.date_of_birth,
      intake_title: intake?.title ?? '',
      schedule: stages.map((s) => ({ ...s, title: s.title ?? s.kind })),
    };
  }

  /** Published lists: roll numbers only, names only when the round's `show_names_publicly` is on. */
  async lists(host: string) {
    const { tenantId } = await this.school(host);
    const rows = (await this.dataSource.query(
      `SELECT * FROM (
         SELECT i.id AS intake_id, i.title AS intake_title, i.show_names_publicly AS names,
                l.id AS list_id, l.kind, l.sequence, m.position, a.roll_number, a.applicant_name,
                row_number() OVER (PARTITION BY l.id ORDER BY m.position) AS rn
           FROM admission_lists l
           JOIN admission_intakes i ON i.id = l.intake_id AND i.deleted_at IS NULL
           JOIN admission_list_members m ON m.list_id = l.id AND m.deleted_at IS NULL
           JOIN admission_applicants a ON a.id = m.applicant_id AND a.deleted_at IS NULL
          WHERE l.tenant_id = $1 AND l.deleted_at IS NULL AND l.published_at IS NOT NULL) x
        WHERE rn <= $2 ORDER BY intake_id, sequence, position`,
      [tenantId, LIST_MEMBER_CAP],
    )) as {
      intake_id: string;
      intake_title: string;
      names: boolean;
      list_id: string;
      kind: string;
      sequence: number;
      position: number;
      roll_number: string | null;
      applicant_name: string;
    }[];
    const out = new Map<
      string,
      {
        id: string;
        kind: string;
        sequence: number;
        intake_id: string;
        intake_title: string;
        members: { position: number; roll_number: string | null; applicant_name?: string }[];
      }
    >();
    for (const r of rows) {
      const l = out.get(r.list_id) ?? {
        id: r.list_id,
        kind: r.kind,
        sequence: r.sequence,
        intake_id: r.intake_id,
        intake_title: r.intake_title,
        members: [],
      };
      l.members.push({
        position: r.position,
        roll_number: r.roll_number,
        ...(r.names ? { applicant_name: r.applicant_name } : {}),
      });
      out.set(r.list_id, l);
    }
    return [...out.values()];
  }
}
