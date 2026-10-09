import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager, type EntityTarget } from 'typeorm';
import {
  APPLICATION_TYPES,
  ApplicationAddressee,
  ApplicationEventKind,
  ApplicationSource,
  ApplicationStatus,
  ApplicationSubjectKind,
  ApplicationType,
  Permission,
  STAFF_ROLES,
  UserRole,
  isGuardianRole,
  roleHasPermission,
} from '@biddaloy/shared';
import type { RequestContext } from '../../common/request-context.util';
import { escapeLikePattern } from '../../common/utils/escape-like.util';
import { SchoolsService } from '../schools/schools.service';
import { FamilyAccessService } from '../students/family-access.service';
import { localToday } from '../attendance/attendance-policy.util';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Application } from './entities/application.entity';
import { ApplicationEvent } from './entities/application-event.entity';
import { ApplicationTag } from './entities/application-tag.entity';
import { APPLICATION_PAYLOAD_DTOS } from './application-types';
import { formatApplicationSerial, nextApplicationSerial } from './application-serial';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import {
  isOpenApplication,
  isOverrideRole,
  ReviewerScopeService,
  type ApplicationCaller,
} from './reviewer-scope';
import type {
  AddresseeOptionDto,
  ApplicationDto,
  ApplicationEventDto,
  ApplicationListDto,
  ApplicationListItemDto,
  ApplicationTagInput,
  CreateApplicationDto,
  LetterPreviewDto,
  LetterPreviewResultDto,
  TagOptionsDto,
} from './dto/application.dto';
import type { QueryApplicationsDto } from './dto/query-applications.dto';

type Code = { message: string; details: { code: string } };
const err = (message: string, code: string): Code => ({ message, details: { code } });

/** Roles a user can be tagged by role (D45): staff who may file/see applications. */
const TAGGABLE_ROLES: UserRole[] = STAFF_ROLES.filter(
  (r) =>
    r !== UserRole.SUPER_ADMIN &&
    r !== UserRole.COMMITTEE &&
    roleHasPermission(r, Permission.APPLICATION_SUBMIT),
);

const STAFF_ROLE_STRINGS: string[] = [...STAFF_ROLES];
const MAX_STAFF_LIST = 200;

type TagKey = { user_id: string } | { role: UserRole };

interface Prepared {
  type: ApplicationType;
  payload: Record<string, unknown>;
  start_date: string | null;
  end_date: string | null;
  subject_student_id: string | null;
  subject_staff_profile_id: string | null;
  applicant_user_id: string | null;
  applicant_name: string | null;
  entered_by_user_id: string | null;
  source: ApplicationSource;
  addressee: ApplicationAddressee | null;
  addressee_user_id: string | null;
  tags: TagKey[];
}

/**
 * Shared by submit and by approve's `granted` (52.3.1): end >= start, and a PERCENT waiver <= 100.
 */
export function assertDateOrderAndPercent(
  type: ApplicationType,
  values: { start_date?: unknown; end_date?: unknown; kind?: unknown; value?: unknown },
): void {
  const start = typeof values.start_date === 'string' ? values.start_date : null;
  const end = typeof values.end_date === 'string' ? values.end_date : null;
  if (start && end && end < start) {
    throw new BadRequestException('end_date must be on or after start_date');
  }
  if (
    type === ApplicationType.FEE_WAIVER &&
    values.kind === 'PERCENT' &&
    Number(values.value) > 100
  ) {
    throw new BadRequestException('A percent waiver cannot exceed 100');
  }
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reviewerScope: ReviewerScopeService,
    private readonly letter: ApplicationLetterService,
    private readonly notify: ApplicationNotifyService,
    private readonly schools: SchoolsService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  // ---------------------------------------------------------------------------
  // Submit + preview
  // ---------------------------------------------------------------------------

  async submit(
    tenantId: string,
    user: ApplicationCaller,
    dto: CreateApplicationDto,
    _ctx: RequestContext,
  ): Promise<ApplicationDto> {
    const prepared = await this.prepare(this.dataSource.manager, tenantId, user, dto);
    const today = await this.today(tenantId);
    const year = Number(today.slice(0, 4));

    const { app, tagRows } = await this.dataSource.transaction(async (manager) => {
      const academicYear = await manager.findOne(AcademicYear, {
        where: { tenant_id: tenantId, is_current: true },
      });
      const no = await nextApplicationSerial(manager, tenantId, year);
      const draft = manager.create(Application, {
        tenant_id: tenantId,
        type: prepared.type,
        status: ApplicationStatus.PENDING,
        source: prepared.source,
        serial_year: year,
        serial_no: no,
        academic_year_id: academicYear?.id ?? null,
        applicant_user_id: prepared.applicant_user_id,
        applicant_name: prepared.applicant_name,
        entered_by_user_id: prepared.entered_by_user_id,
        subject_student_id: prepared.subject_student_id,
        subject_staff_profile_id: prepared.subject_staff_profile_id,
        payload: prepared.payload,
        start_date: prepared.start_date,
        end_date: prepared.end_date,
        addressee: prepared.addressee,
        addressee_user_id: prepared.addressee_user_id,
        current_step: 0,
        letter_text: '',
        letter_locale: '',
      });
      const first = await this.reviewerScope.firstStepIndex(manager, draft);
      draft.current_step = first.index;

      const ctx = await this.letter.buildContext(manager, tenantId, {
        type: prepared.type,
        payload: prepared.payload,
        subject_student_id: prepared.subject_student_id,
        subject_staff_profile_id: prepared.subject_staff_profile_id,
        addressee: prepared.addressee,
        addressee_user_id: prepared.addressee_user_id,
        applicant_user_id: prepared.applicant_user_id,
        applicant_name: prepared.applicant_name,
        serial: formatApplicationSerial(year, no),
        date: today,
      });
      draft.letter_text = this.letter.render(prepared.type, prepared.payload, ctx);
      draft.letter_locale = ctx.locale;

      const saved = await manager.save(draft);
      await this.addEvent(manager, saved, user.userId, ApplicationEventKind.SUBMITTED, {
        data: { skipped_steps: first.skipped },
      });
      const rows = await this.insertTags(manager, saved, user.userId, prepared.tags);
      return { app: saved, tagRows: rows };
    });

    // After commit; a notification failure never fails the submit.
    await this.safely(async () => {
      await this.notify.onSubmitted(app);
      if (tagRows.length > 0) await this.notify.onTagged(app, tagRows);
    });

    return this.detail(this.dataSource.manager, user, app);
  }

  async letterPreview(
    tenantId: string,
    user: ApplicationCaller,
    dto: LetterPreviewDto,
  ): Promise<LetterPreviewResultDto> {
    const manager = this.dataSource.manager;
    const prepared = await this.prepare(manager, tenantId, user, dto as CreateApplicationDto);
    const ctx = await this.letter.buildContext(manager, tenantId, {
      type: prepared.type,
      payload: prepared.payload,
      subject_student_id: prepared.subject_student_id,
      subject_staff_profile_id: prepared.subject_staff_profile_id,
      addressee: prepared.addressee,
      addressee_user_id: prepared.addressee_user_id,
      applicant_user_id: prepared.applicant_user_id,
      applicant_name: prepared.applicant_name,
      serial: null,
      date: await this.today(tenantId),
    });
    return {
      letter_text: this.letter.render(prepared.type, prepared.payload, ctx),
      letter_locale: ctx.locale,
    };
  }

  /** Steps 4-7 of the ticket: everything checkable before anything is written. */
  private async prepare(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    dto: CreateApplicationDto,
  ): Promise<Prepared> {
    const def = APPLICATION_TYPES[dto.type];

    if (isGuardianRole(user.role) && dto.tags && dto.tags.length > 0) {
      throw new BadRequestException(
        err('Only staff can tag people on an application', 'APPLICATION_TAGS_STAFF_ONLY'),
      );
    }
    if (dto.on_behalf_of_user_id && dto.applicant_name) {
      throw new BadRequestException(
        err('Give on_behalf_of_user_id or applicant_name, not both', 'APPLICATION_ON_BEHALF_BOTH'),
      );
    }
    const onBehalf = Boolean(dto.on_behalf_of_user_id || dto.applicant_name);
    if (onBehalf && !roleHasPermission(user.role, Permission.APPLICATION_MANAGE)) {
      throw new ForbiddenException(
        err(
          'Only office staff can enter an application on behalf of someone',
          'APPLICATION_ON_BEHALF_FORBIDDEN',
        ),
      );
    }

    const { payload, startDate, endDate } = await this.validatePayload(dto.type, dto.payload);

    // Who the applicant is, and which tenant roles they hold (decides family vs staff below).
    let applicantUserId: string | null = user.userId;
    let applicantRoles: string[] = [user.role];
    if (onBehalf) {
      applicantUserId = dto.on_behalf_of_user_id ?? null;
      applicantRoles = [];
      if (applicantUserId) {
        applicantRoles = await this.tenantRoles(manager, tenantId, applicantUserId);
        if (applicantRoles.length === 0) {
          throw new UnprocessableEntityException(
            err('That user is not a member of this school', 'APPLICATION_APPLICANT_INVALID'),
          );
        }
      }
    }

    // Subject: exactly one, and of a kind this type allows.
    let studentId = dto.subject_student_id ?? null;
    let staffId = dto.subject_staff_profile_id ?? null;
    if (
      !studentId &&
      !staffId &&
      applicantUserId &&
      def.subject.includes(ApplicationSubjectKind.STAFF)
    ) {
      staffId = await this.staffProfileIdOfUser(manager, tenantId, applicantUserId);
    }
    const kind =
      studentId && !staffId
        ? ApplicationSubjectKind.STUDENT
        : staffId && !studentId
          ? ApplicationSubjectKind.STAFF
          : null;
    if (!kind || !def.subject.includes(kind)) {
      throw new UnprocessableEntityException(
        err('The subject does not match this application type', 'APPLICATION_SUBJECT_MISMATCH'),
      );
    }

    if (!onBehalf) {
      await this.assertOwnSubject(manager, tenantId, user, studentId, staffId);
    } else {
      await this.assertSubjectExists(manager, tenantId, studentId, staffId);
      if (applicantUserId) {
        await this.assertApplicantOwnsSubject(
          manager,
          tenantId,
          applicantUserId,
          applicantRoles,
          studentId,
          staffId,
        );
      }
    }

    await this.assertReferencedIds(manager, tenantId, payload);

    const family = !applicantRoles.some((r) => STAFF_ROLE_STRINGS.includes(r));
    const { addressee, addresseeUserId } = await this.resolveAddressee(
      manager,
      tenantId,
      dto,
      family,
      studentId,
    );
    const tags = await this.normalizeTags(manager, tenantId, dto.tags ?? []);

    return {
      type: dto.type,
      payload,
      start_date: startDate,
      end_date: endDate,
      subject_student_id: studentId,
      subject_staff_profile_id: staffId,
      applicant_user_id: applicantUserId,
      applicant_name: onBehalf && !applicantUserId ? (dto.applicant_name ?? null) : null,
      entered_by_user_id: onBehalf ? user.userId : null,
      source: onBehalf ? ApplicationSource.PAPER : ApplicationSource.APP,
      addressee,
      addressee_user_id: addresseeUserId,
      tags,
    };
  }

  private async validatePayload(
    type: ApplicationType,
    raw: Record<string, unknown>,
  ): Promise<{
    payload: Record<string, unknown>;
    startDate: string | null;
    endDate: string | null;
  }> {
    const instance = plainToInstance(APPLICATION_PAYLOAD_DTOS[type], raw);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    }
    const payload = { ...instance } as Record<string, unknown>;

    assertDateOrderAndPercent(type, payload);
    const start = typeof payload.start_date === 'string' ? payload.start_date : null;
    const end = typeof payload.end_date === 'string' ? payload.end_date : null;
    const isLeave = type === ApplicationType.STAFF_LEAVE || type === ApplicationType.STUDENT_LEAVE;
    return { payload, startDate: isLeave ? start : null, endDate: isLeave ? end : null };
  }

  /** Not on behalf: the caller must be (or be linked to) the subject (D8, D43). */
  private async assertOwnSubject(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    studentId: string | null,
    staffId: string | null,
  ): Promise<void> {
    if (staffId) {
      const own = await this.staffProfileIdOfUser(manager, tenantId, user.userId);
      if (own !== staffId) {
        throw new ForbiddenException(
          err('You can only apply for your own staff profile', 'APPLICATION_NOT_YOUR_PROFILE'),
        );
      }
    }
    if (studentId) {
      const linked = await this.familyAccess.getLinkedStudentIds(user.role, user.userId, tenantId);
      if (!linked.includes(studentId)) {
        throw new ForbiddenException(
          err('You are not linked to that student', 'APPLICATION_STUDENT_NOT_LINKED'),
        );
      }
    }
  }

  private async assertSubjectExists(
    manager: EntityManager,
    tenantId: string,
    studentId: string | null,
    staffId: string | null,
  ): Promise<void> {
    const rows = studentId
      ? await manager.query(
          `SELECT 1 FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [studentId, tenantId],
        )
      : await manager.query(`SELECT 1 FROM staff_profiles WHERE id = $1 AND tenant_id = $2`, [
          staffId,
          tenantId,
        ]);
    if (rows.length === 0) {
      throw new UnprocessableEntityException(
        err('Subject not found', 'APPLICATION_SUBJECT_NOT_FOUND'),
      );
    }
  }

  /** On behalf of a user with an account: same subject rule as if they had submitted. */
  private async assertApplicantOwnsSubject(
    manager: EntityManager,
    tenantId: string,
    applicantUserId: string,
    roles: string[],
    studentId: string | null,
    staffId: string | null,
  ): Promise<void> {
    let ok = false;
    if (staffId) {
      ok = (await this.staffProfileIdOfUser(manager, tenantId, applicantUserId)) === staffId;
    } else if (studentId) {
      for (const role of roles) {
        const linked = await this.familyAccess.getLinkedStudentIds(role, applicantUserId, tenantId);
        if (linked.includes(studentId)) ok = true;
      }
    }
    if (!ok) {
      throw new UnprocessableEntityException(
        err('That applicant is not linked to the subject', 'APPLICATION_APPLICANT_NOT_LINKED'),
      );
    }
  }

  /** Ids in the payload must exist in this tenant (never trust a foreign id). */
  private async assertReferencedIds(
    manager: EntityManager,
    tenantId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const refs: Array<[string, EntityTarget<{ id: string }>]> = [
      ['to_section_id', ClassSection],
      ['class_section_id', ClassSection],
      ['exam_id', Exam],
      ['subject_id', Subject],
    ];
    for (const [key, entity] of refs) {
      const id = payload[key];
      if (typeof id !== 'string') continue;
      const found = await manager.findOne(entity, { where: { id, tenant_id: tenantId } as never });
      if (!found) {
        throw new UnprocessableEntityException(
          err(`${key} does not exist in this school`, 'APPLICATION_REFERENCE_NOT_FOUND'),
        );
      }
    }
  }

  /** GENERAL needs an addressee (D13, D16, D38); every other type forbids one. */
  private async resolveAddressee(
    manager: EntityManager,
    tenantId: string,
    dto: CreateApplicationDto,
    family: boolean,
    studentId: string | null,
  ): Promise<{ addressee: ApplicationAddressee | null; addresseeUserId: string | null }> {
    const bad = (m: string) =>
      new UnprocessableEntityException(err(m, 'APPLICATION_ADDRESSEE_INVALID'));
    if (dto.type !== ApplicationType.GENERAL) {
      if (dto.addressee || dto.addressee_user_id)
        throw bad('Only a general application has an addressee');
      return { addressee: null, addresseeUserId: null };
    }
    if (!dto.addressee) throw bad('An addressee is required');

    if (family) {
      if (dto.addressee === ApplicationAddressee.STAFF_USER || dto.addressee_user_id) {
        throw bad('Choose the class teacher, the headmaster or the office');
      }
      if (dto.addressee === ApplicationAddressee.CLASS_TEACHER) {
        const teacher = studentId
          ? await this.reviewerScope.classTeacherUserId(manager, tenantId, studentId)
          : null;
        if (!teacher) {
          throw new UnprocessableEntityException(
            err('This student has no class teacher right now', 'APPLICATION_NO_CLASS_TEACHER'),
          );
        }
      }
      return { addressee: dto.addressee, addresseeUserId: null };
    }

    if (dto.addressee !== ApplicationAddressee.STAFF_USER || !dto.addressee_user_id) {
      throw bad('Staff must address a staff member');
    }
    const staff = await this.activeStaff(manager, tenantId, { ids: [dto.addressee_user_id] });
    if (staff.length === 0) throw bad('The addressee must be an active staff member');
    return { addressee: dto.addressee, addresseeUserId: dto.addressee_user_id };
  }

  // ---------------------------------------------------------------------------
  // Tags (D12, D14, D45)
  // ---------------------------------------------------------------------------

  private async normalizeTags(
    manager: EntityManager,
    tenantId: string,
    input: ApplicationTagInput[],
  ): Promise<TagKey[]> {
    const invalid = () =>
      new UnprocessableEntityException(err('Invalid tag', 'APPLICATION_TAG_INVALID'));
    const seen = new Set<string>();
    const tags: TagKey[] = [];
    const userIds: string[] = [];
    for (const t of input) {
      if (Boolean(t.user_id) === Boolean(t.role)) throw invalid(); // exactly one
      if (t.role) {
        if (!TAGGABLE_ROLES.includes(t.role)) throw invalid();
        if (!seen.has(`r:${t.role}`)) tags.push({ role: t.role });
        seen.add(`r:${t.role}`);
      } else if (t.user_id) {
        if (!seen.has(`u:${t.user_id}`)) {
          tags.push({ user_id: t.user_id });
          userIds.push(t.user_id);
        }
        seen.add(`u:${t.user_id}`);
      }
    }
    if (userIds.length > 0) {
      const staff = await this.activeStaff(manager, tenantId, { ids: userIds });
      if (staff.length !== userIds.length) throw invalid();
    }
    return tags;
  }

  /** `.orIgnore()` makes a duplicate a no-op; returns only the rows actually inserted. */
  private async insertTags(
    manager: EntityManager,
    app: Application,
    actorId: string,
    tags: TagKey[],
  ): Promise<ApplicationTag[]> {
    if (tags.length === 0) return [];
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ApplicationTag)
      .values(
        tags.map((t) => ({
          tenant_id: app.tenant_id,
          application_id: app.id,
          user_id: 'user_id' in t ? t.user_id : null,
          role: 'role' in t ? t.role : null,
          created_by_user_id: actorId,
        })),
      )
      .orIgnore()
      .returning('*')
      .execute();
    const inserted = result.raw as ApplicationTag[];
    if (inserted.length > 0) {
      await this.addEvent(manager, app, actorId, ApplicationEventKind.TAGGED, {
        data: {
          tags: inserted.map((r) => (r.user_id ? { user_id: r.user_id } : { role: r.role })),
        },
      });
    }
    return inserted;
  }

  async addTags(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    tags: ApplicationTagInput[],
  ): Promise<ApplicationDto> {
    const manager = this.dataSource.manager;
    const app = await this.visible(manager, tenantId, user, id);
    const allowed =
      app.applicant_user_id === user.userId ||
      roleHasPermission(user.role, Permission.APPLICATION_MANAGE) ||
      (await this.reviewerScope.canDecide(manager, user, app)) !== false;
    if (!allowed) {
      throw new ForbiddenException('You cannot tag people on this application');
    }
    const keys = await this.normalizeTags(manager, tenantId, tags);
    const rows = await manager.transaction((tx) => this.insertTags(tx, app, user.userId, keys));
    if (rows.length > 0) await this.safely(() => this.notify.onTagged(app, rows));
    return this.detail(manager, user, app);
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(
    tenantId: string,
    user: ApplicationCaller,
    query: QueryApplicationsDto,
  ): Promise<ApplicationListDto> {
    const view = query.view ?? 'mine';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (limit < 1 || limit > 100 || page < 1) {
      throw new BadRequestException('page must be >= 1 and limit between 1 and 100');
    }
    const manager = this.dataSource.manager;

    const qb = manager
      .getRepository(Application)
      .createQueryBuilder('a')
      .leftJoin('students', 's', 's.id = a.subject_student_id AND s.tenant_id = a.tenant_id')
      .leftJoin('class_sections', 'cs', 'cs.id = s.class_section_id AND cs.tenant_id = a.tenant_id')
      .leftJoin(
        'staff_profiles',
        'sp',
        'sp.id = a.subject_staff_profile_id AND sp.tenant_id = a.tenant_id',
      )
      .leftJoin('users', 'su', 'su.id = sp.user_id')
      .leftJoin('users', 'au', 'au.id = a.applicant_user_id')
      .where('a.tenant_id = :tenantId', { tenantId });

    if (view === 'inbox') {
      await this.reviewerScope.applyInbox(qb, tenantId, user);
    } else if (view === 'all') {
      if (!roleHasPermission(user.role, Permission.APPLICATION_MANAGE)) {
        throw new ForbiddenException('You cannot see every application');
      }
    } else {
      const linked = await this.familyAccess.getLinkedStudentIds(user.role, user.userId, tenantId);
      qb.andWhere(
        `(a.applicant_user_id = :me OR a.entered_by_user_id = :me OR sp.user_id = :me OR s.user_id = :me
          ${linked.length > 0 ? 'OR a.subject_student_id IN (:...linked)' : ''})`,
        { me: user.userId, linked },
      );
    }

    if (query.type) qb.andWhere('a.type = :type', { type: query.type });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.from) qb.andWhere('a.created_at::date >= :from', { from: query.from });
    if (query.to) qb.andWhere('a.created_at::date <= :to', { to: query.to });
    if (query.class_id) qb.andWhere('cs.class_id = :classId', { classId: query.class_id });
    if (query.student_id)
      qb.andWhere('a.subject_student_id = :studentId', { studentId: query.student_id });
    if (query.staff_profile_id) {
      qb.andWhere('a.subject_staff_profile_id = :staffId', { staffId: query.staff_profile_id });
    }
    const q = query.q?.trim();
    if (q) {
      const serial = /^(?:(\d{4})\s*\/\s*)?(\d{1,6})$/.exec(q);
      const like = `%${escapeLikePattern(q)}%`;
      const serialClause = serial
        ? ` OR (a.serial_no = :serialNo${serial[1] ? ' AND a.serial_year = :serialYear' : ''})`
        : '';
      qb.andWhere(
        `(au.full_name ILIKE :like OR a.applicant_name ILIKE :like OR s.full_name ILIKE :like
          OR s.full_name_bn ILIKE :like OR su.full_name ILIKE :like${serialClause})`,
        {
          like,
          serialNo: serial ? Number(serial[2]) : 0,
          serialYear: serial?.[1] ? Number(serial[1]) : 0,
        },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('a.created_at', view === 'inbox' ? 'ASC' : 'DESC')
      .addOrderBy('a.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return {
      data: await this.hydrate(manager, user, rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(tenantId: string, user: ApplicationCaller, id: string): Promise<ApplicationDto> {
    const manager = this.dataSource.manager;
    const app = await this.visible(manager, tenantId, user, id);
    return this.detail(manager, user, app);
  }

  /** "Not yours" and "doesn't exist" are both 404 (as `staff-document.service.ts` does). */
  private async visible(
    manager: EntityManager,
    tenantId: string,
    user: ApplicationCaller,
    id: string,
  ): Promise<Application> {
    const app = await manager.findOne(Application, { where: { id, tenant_id: tenantId } });
    if (!app || !(await this.reviewerScope.canView(manager, user, app))) {
      throw new NotFoundException('Application not found');
    }
    return app;
  }

  // ---------------------------------------------------------------------------
  // Withdraw + comment
  // ---------------------------------------------------------------------------

  async withdraw(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    _ctx: RequestContext,
  ): Promise<ApplicationDto> {
    const { app, event } = await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOne(Application, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!found || !(await this.reviewerScope.canView(manager, user, found))) {
        throw new NotFoundException('Application not found');
      }
      if (found.applicant_user_id !== user.userId) {
        throw new ForbiddenException('Only the applicant can withdraw an application');
      }
      if (!isOpenApplication(found)) {
        throw new UnprocessableEntityException(
          err('Only a pending application can be withdrawn', 'APPLICATION_NOT_PENDING'),
        );
      }
      found.status = ApplicationStatus.WITHDRAWN;
      await manager.save(found);
      const ev = await this.addEvent(
        manager,
        found,
        user.userId,
        ApplicationEventKind.WITHDRAWN,
        {},
      );
      return { app: found, event: ev };
    });
    await this.safely(() => this.notify.onStatusChanged(app, event));
    return this.detail(this.dataSource.manager, user, app);
  }

  async comment(
    tenantId: string,
    user: ApplicationCaller,
    id: string,
    note: string,
  ): Promise<ApplicationEventDto> {
    const manager = this.dataSource.manager;
    const app = await this.visible(manager, tenantId, user, id);
    const event = await this.addEvent(manager, app, user.userId, ApplicationEventKind.COMMENT, {
      note,
    });
    await this.safely(() => this.notify.onComment(app, event));
    const [row] = await this.loadEvents(manager, tenantId, app.id, event.id);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Pickers
  // ---------------------------------------------------------------------------

  async addressees(
    tenantId: string,
    user: ApplicationCaller,
    studentId?: string,
  ): Promise<AddresseeOptionDto[]> {
    const manager = this.dataSource.manager;
    if (isGuardianRole(user.role)) {
      const out: AddresseeOptionDto[] = [];
      if (studentId) {
        const linked = await this.familyAccess.getLinkedStudentIds(
          user.role,
          user.userId,
          tenantId,
        );
        const teacherId = linked.includes(studentId)
          ? await this.reviewerScope.classTeacherUserId(manager, tenantId, studentId)
          : null;
        if (teacherId) {
          const [u] = await manager.query(`SELECT id, full_name FROM users WHERE id = $1`, [
            teacherId,
          ]);
          out.push({ addressee: ApplicationAddressee.CLASS_TEACHER, user: u ?? null, role: null });
        }
      }
      out.push(
        { addressee: ApplicationAddressee.HEADMASTER, user: null, role: null },
        { addressee: ApplicationAddressee.OFFICE, user: null, role: null },
      );
      return out;
    }
    const staff = await this.activeStaff(manager, tenantId, { limit: MAX_STAFF_LIST });
    return staff
      .filter((s) => s.id !== user.userId)
      .map((s) => ({
        addressee: ApplicationAddressee.STAFF_USER,
        user: { id: s.id, full_name: s.full_name },
        role: s.role,
      }));
  }

  async tagOptions(tenantId: string, q: string): Promise<TagOptionsDto> {
    const staff = await this.activeStaff(this.dataSource.manager, tenantId, { q, limit: 20 });
    return { users: staff, roles: TAGGABLE_ROLES };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async today(tenantId: string): Promise<string> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return localToday(settings.region?.timezone ?? 'UTC');
  }

  private async safely(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Application notification failed: ${(e as Error).message}`);
    }
  }

  private async tenantRoles(
    manager: EntityManager,
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const rows: Array<{ role: string }> = await manager.query(
      `SELECT role::text AS role FROM user_tenants WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [tenantId, userId],
    );
    return rows.map((r) => r.role);
  }

  private async staffProfileIdOfUser(
    manager: EntityManager,
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await manager.query(
      `SELECT id FROM staff_profiles WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
      [tenantId, userId],
    );
    return rows[0]?.id ?? null;
  }

  /** Active tenant users whose role is a staff role, one row per user, ordered by name. */
  private async activeStaff(
    manager: EntityManager,
    tenantId: string,
    opts: { ids?: string[]; q?: string; limit?: number },
  ): Promise<Array<{ id: string; full_name: string; role: UserRole }>> {
    return manager.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (u.id) u.id, u.full_name, ut.role::text AS role
           FROM user_tenants ut
           JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
          WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2)
            AND ($3::uuid[] IS NULL OR u.id = ANY($3))
            AND ($4::text IS NULL OR u.full_name ILIKE $4)
          ORDER BY u.id, ut.role
       ) x ORDER BY x.full_name, x.id LIMIT $5`,
      [
        tenantId,
        STAFF_ROLE_STRINGS,
        opts.ids ?? null,
        opts.q ? `%${escapeLikePattern(opts.q)}%` : null,
        opts.limit ?? 1000,
      ],
    );
  }

  /** Inserts with `clock_timestamp()` so events in one transaction keep their order. */
  private async addEvent(
    manager: EntityManager,
    app: Application,
    actorId: string,
    kind: ApplicationEventKind,
    extra: { note?: string; data?: Record<string, unknown> },
  ): Promise<ApplicationEvent> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ApplicationEvent)
      .values({
        tenant_id: app.tenant_id,
        application_id: app.id,
        actor_user_id: actorId,
        kind,
        step: app.current_step,
        note: extra.note ?? null,
        // jsonb: the query builder cannot type a free-form object
        data: (extra.data ?? null) as never,
        created_at: () => 'clock_timestamp()',
      })
      .returning('*')
      .execute();
    return result.raw[0] as ApplicationEvent;
  }

  private async loadEvents(
    manager: EntityManager,
    tenantId: string,
    applicationId: string,
    onlyId?: string,
  ): Promise<ApplicationEventDto[]> {
    const rows: Array<ApplicationEvent & { actor_name: string }> = await manager.query(
      `SELECT e.id, e.kind, e.step, e.actor_user_id, u.full_name AS actor_name, e.note, e.data, e.created_at
         FROM application_events e JOIN users u ON u.id = e.actor_user_id
        WHERE e.tenant_id = $1 AND e.application_id = $2 AND ($3::uuid IS NULL OR e.id = $3)
        ORDER BY e.created_at ASC, e.id ASC`,
      [tenantId, applicationId, onlyId ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      step: r.step,
      actor_user_id: r.actor_user_id,
      actor_name: r.actor_name,
      note: r.note,
      data: r.data,
      created_at: new Date(r.created_at).toISOString(),
    }));
  }

  private async detail(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
  ): Promise<ApplicationDto> {
    const [item] = await this.hydrate(manager, user, [app]);
    const [events, tags, attachments] = await Promise.all([
      this.loadEvents(manager, app.tenant_id, app.id),
      manager.query(
        `SELECT t.id, t.user_id, u.full_name AS user_name, t.role
           FROM application_tags t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.tenant_id = $1 AND t.application_id = $2 ORDER BY t.created_at, t.id`,
        [app.tenant_id, app.id],
      ),
      manager.query(
        `SELECT id, file_name, mime_type, size_bytes, uploaded_by_user_id, created_at
           FROM application_attachments WHERE tenant_id = $1 AND application_id = $2
          ORDER BY created_at, id`,
        [app.tenant_id, app.id],
      ),
    ]);
    return {
      ...item,
      letter_text: app.letter_text,
      letter_locale: app.letter_locale,
      granted: app.granted,
      effect_result: app.effect_result,
      events,
      tags,
      attachments: attachments.map((a: { created_at: Date }) => ({
        ...a,
        created_at: new Date(a.created_at).toISOString(),
      })),
    } as ApplicationDto;
  }

  /** Builds list rows for a page of applications with a handful of batched lookups. */
  private async hydrate(
    manager: EntityManager,
    user: ApplicationCaller,
    apps: Application[],
  ): Promise<ApplicationListItemDto[]> {
    if (apps.length === 0) return [];
    const tenantId = apps[0].tenant_id;
    const uniq = (xs: Array<string | null>) => [
      ...new Set(xs.filter((x): x is string => Boolean(x))),
    ];

    const userIds = uniq(
      apps.flatMap((a) => [
        a.applicant_user_id,
        a.entered_by_user_id,
        a.decided_by_user_id,
        a.addressee_user_id,
      ]),
    );
    const studentIds = uniq(apps.map((a) => a.subject_student_id));
    const staffIds = uniq(apps.map((a) => a.subject_staff_profile_id));
    const sectionIds = uniq(
      apps.flatMap((a) =>
        [a.payload.to_section_id, a.payload.class_section_id].map((v) =>
          typeof v === 'string' ? v : null,
        ),
      ),
    );
    const examIds = uniq(
      apps.map((a) => (typeof a.payload.exam_id === 'string' ? a.payload.exam_id : null)),
    );
    const subjectIds = uniq(
      apps.map((a) => (typeof a.payload.subject_id === 'string' ? a.payload.subject_id : null)),
    );

    const [names, roles, students, staff, sections, exams, subjects] = await Promise.all([
      manager.query(`SELECT id, full_name FROM users WHERE id = ANY($1)`, [userIds]),
      manager.query(
        `SELECT DISTINCT ON (user_id) user_id, role::text AS role FROM user_tenants
          WHERE tenant_id = $1 AND user_id = ANY($2) AND deleted_at IS NULL ORDER BY user_id, created_at`,
        [tenantId, userIds],
      ),
      manager.query(
        `SELECT s.id, coalesce(s.full_name_bn, s.full_name) AS name, s.roll_number::text AS roll,
                cs.section_name, c.name AS class_name
           FROM students s
           LEFT JOIN class_sections cs ON cs.id = s.class_section_id
           LEFT JOIN classes c ON c.id = cs.class_id
          WHERE s.tenant_id = $1 AND s.id = ANY($2)`,
        [tenantId, studentIds],
      ),
      manager.query(
        `SELECT sp.id, u.full_name AS name,
                (SELECT t.designations[1]::text FROM teachers t
                  WHERE t.staff_profile_id = sp.id AND t.deleted_at IS NULL LIMIT 1) AS designation
           FROM staff_profiles sp JOIN users u ON u.id = sp.user_id
          WHERE sp.tenant_id = $1 AND sp.id = ANY($2)`,
        [tenantId, staffIds],
      ),
      manager.query(
        `SELECT cs.id, c.name || ' · ' || cs.section_name AS name
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.tenant_id = $1 AND cs.id = ANY($2)`,
        [tenantId, sectionIds],
      ),
      manager.query(`SELECT id, name FROM exams WHERE tenant_id = $1 AND id = ANY($2)`, [
        tenantId,
        examIds,
      ]),
      manager.query(
        `SELECT id, coalesce(name_bn, name_en) AS name FROM subjects WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, subjectIds],
      ),
    ]);
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const nameOf = byId<{ id: string; full_name: string }>(names);
    const roleOf = new Map<string, string>(
      (roles as Array<{ user_id: string; role: string }>).map((r) => [r.user_id, r.role]),
    );
    const studentOf = byId<{
      id: string;
      name: string;
      roll: string | null;
      section_name: string | null;
      class_name: string | null;
    }>(students);
    const staffOf = byId<{ id: string; name: string; designation: string | null }>(staff);
    const sectionName = byId<{ id: string; name: string }>(sections);
    const examName = byId<{ id: string; name: string }>(exams);
    const subjectName = byId<{ id: string; name: string }>(subjects);

    return Promise.all(
      apps.map(async (a): Promise<ApplicationListItemDto> => {
        const st = a.subject_student_id ? studentOf.get(a.subject_student_id) : undefined;
        const sf = a.subject_staff_profile_id ? staffOf.get(a.subject_staff_profile_id) : undefined;
        const refNames: Record<string, string> = {};
        for (const key of ['to_section_id', 'class_section_id'] as const) {
          const n =
            typeof a.payload[key] === 'string'
              ? sectionName.get(a.payload[key] as string)?.name
              : undefined;
          if (n) refNames[key] = n;
        }
        const exam =
          typeof a.payload.exam_id === 'string' ? examName.get(a.payload.exam_id)?.name : undefined;
        if (exam) refNames.exam_id = exam;
        const subject =
          typeof a.payload.subject_id === 'string'
            ? subjectName.get(a.payload.subject_id)?.name
            : undefined;
        if (subject) refNames.subject_id = subject;

        return {
          id: a.id,
          serial: formatApplicationSerial(a.serial_year, a.serial_no),
          serial_year: a.serial_year,
          serial_no: a.serial_no,
          type: a.type,
          status: a.status,
          source: a.source,
          academic_year_id: a.academic_year_id,
          applicant_user_id: a.applicant_user_id,
          applicant_name:
            (a.applicant_user_id && nameOf.get(a.applicant_user_id)?.full_name) ||
            a.applicant_name ||
            '',
          applicant_role:
            (a.applicant_user_id
              ? (roleOf.get(a.applicant_user_id) as UserRole | undefined)
              : undefined) ?? null,
          entered_by_user_id: a.entered_by_user_id,
          entered_by_name: a.entered_by_user_id
            ? (nameOf.get(a.entered_by_user_id)?.full_name ?? null)
            : null,
          subject_kind: a.subject_student_id
            ? ApplicationSubjectKind.STUDENT
            : ApplicationSubjectKind.STAFF,
          subject_student_id: a.subject_student_id,
          subject_staff_profile_id: a.subject_staff_profile_id,
          subject_name: st?.name ?? sf?.name ?? '',
          subject_class_name: st?.class_name ?? null,
          subject_section_name: st?.section_name ?? null,
          subject_roll: st?.roll ?? null,
          subject_designation: sf?.designation ?? null,
          payload: a.payload,
          ref_names: refNames,
          start_date: a.start_date,
          end_date: a.end_date,
          addressee: a.addressee,
          addressee_user_id: a.addressee_user_id,
          addressee_name: a.addressee_user_id
            ? (nameOf.get(a.addressee_user_id)?.full_name ?? null)
            : null,
          current_step: a.current_step,
          step_count: APPLICATION_TYPES[a.type].steps.length,
          decided_by_user_id: a.decided_by_user_id,
          decided_by_name: a.decided_by_user_id
            ? (nameOf.get(a.decided_by_user_id)?.full_name ?? null)
            : null,
          decided_at: a.decided_at ? new Date(a.decided_at).toISOString() : null,
          created_at: new Date(a.created_at).toISOString(),
          can: await this.computeCan(manager, user, a),
        };
      }),
    );
  }

  /** `comment` is always true here: every row we build was already visible to the caller. */
  private async computeCan(
    manager: EntityManager,
    user: ApplicationCaller,
    app: Application,
  ): Promise<ApplicationListItemDto['can']> {
    const decide = (await this.reviewerScope.canDecide(manager, user, app)) !== false;
    const isApplicant = app.applicant_user_id === user.userId;
    let cancel = false;
    if (
      app.status === ApplicationStatus.APPROVED &&
      APPLICATION_TYPES[app.type].cancellable &&
      !isApplicant
    ) {
      // D41
      if (app.type === ApplicationType.STAFF_LEAVE) {
        cancel = roleHasPermission(user.role, Permission.LEAVE_APPROVE);
      } else if (app.type === ApplicationType.STUDENT_LEAVE) {
        cancel =
          isOverrideRole(user.role) ||
          (app.subject_student_id !== null &&
            (await this.reviewerScope.classTeacherUserId(
              manager,
              app.tenant_id,
              app.subject_student_id,
            )) === user.userId);
      }
    }
    return {
      decide,
      consider: decide,
      withdraw: isApplicant && isOpenApplication(app),
      cancel,
      comment: true,
    };
  }
}
