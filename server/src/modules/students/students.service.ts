import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Brackets, EntityManager } from 'typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { CreateStudentDto, UpdateStudentDto, QueryStudentDto } from './dto/students.dto';
import {
  CreateGuardianDto,
  UpdateGuardianDto,
  UpdateOwnGuardianDto,
  QueryGuardianDto,
} from './dto/students.dto';
import { CommunicationMedium } from '@biddaloy/shared';
import { nextRollNumber } from './roll-number.util';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly repo: Repository<Student>,
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
  ) {}

  /**
   * @param manager Optional transaction-scoped manager. When provided (e.g.
   * by bulk upload, which resolves/creates a guardian and a student as one
   * atomic unit), all reads/writes run on it instead of starting a new
   * transaction — so a failure here rolls back sibling writes too.
   */
  async create(dto: CreateStudentDto, tenantId: string, manager?: EntityManager): Promise<Student> {
    const sectionRepo = manager ? manager.getRepository(ClassSection) : this.sectionRepo;
    const guardianRepo = manager ? manager.getRepository(Guardian) : this.guardianRepo;
    const studentRepo = manager ? manager.getRepository(Student) : this.repo;

    // Validate class_section_id belongs to tenant
    const section = await sectionRepo.findOne({
      where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class'],
    });
    if (!section) {
      throw new NotFoundException(`Class section with ID "${dto.class_section_id}" not found`);
    }

    // Guard validations
    if (dto.guardian_ids?.length) {
      const guardianCount = await guardianRepo.count({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardianCount !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
    }

    const currentYear = new Date().getFullYear();

    // Atomically generate reg number, determine roll number, and persist
    const generateAndSave = async (txManager: EntityManager) => {
      const txStudentRepo = txManager.getRepository(Student);

      // Locking the "last matching row" only serializes concurrent creates
      // when such a row already exists — the very first student of a new
      // year (or a brand-new class section) has nothing to lock, letting
      // two concurrent requests both compute the same next number. Advisory
      // locks serialize on the (tenant, year) / (section) key itself, so
      // they protect that first-insert case too, and auto-release at
      // commit/rollback (same pattern as invoice-numbering.util.ts).
      await txManager.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [
        tenantId,
        currentYear,
      ]);

      const lastStudent = await txStudentRepo
        .createQueryBuilder('s')
        .withDeleted()
        .where('s.tenant_id = :tenantId', { tenantId })
        .andWhere('s.registration_number LIKE :pattern', { pattern: `REG-${currentYear}-%` })
        .orderBy('s.registration_number', 'DESC')
        .getOne();

      let nextSeq = 1;
      if (lastStudent) {
        const parts = lastStudent.registration_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }
      const regNumber = `REG-${currentYear}-${String(nextSeq).padStart(4, '0')}`;

      // Same reasoning for roll numbers, scoped per class_section — see
      // roll-number.util.ts's own comment.
      const rollNumber =
        dto.roll_number ?? (await nextRollNumber(txManager, dto.class_section_id, tenantId));

      // Create and save student
      const student = txStudentRepo.create({
        full_name: dto.full_name,
        registration_number: regNumber,
        roll_number: rollNumber,
        class_section_id: dto.class_section_id,
        date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
        gender: dto.gender ?? null,
        home_address: dto.home_address ?? null,
        preferred_communication: dto.preferred_communication as CommunicationMedium,
        tenant_id: tenantId,
      });

      const savedStudent = await txStudentRepo.save(student);

      // [8.11.3] Every new student gets a day-one enrollment history row —
      // `EnrollmentService.create` isn't reused here (it re-validates the
      // student/class/section chain this method already just validated,
      // and its ACTIVE-sync side effect would immediately reassign the
      // roll number this call just picked). Written directly against the
      // same transaction manager so a rollback here undoes both writes.
      // `section` (validated above, `relations: ['class']`) supplies both
      // the class and its academic year without an extra query.
      const txEnrollmentRepo = txManager.getRepository(Enrollment);
      await txEnrollmentRepo.save(
        txEnrollmentRepo.create({
          student_id: savedStudent.id,
          class_id: section.class_id,
          section_id: dto.class_section_id,
          academic_year_id: section.class.academic_year_id,
          tenant_id: tenantId,
        }),
      );

      return savedStudent;
    };

    const savedStudent = manager
      ? await generateAndSave(manager)
      : await this.repo.manager.transaction(generateAndSave);

    // Link guardians
    if (dto.guardian_ids?.length) {
      const guardians = await guardianRepo.find({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardians.length !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
      savedStudent.guardians = guardians;
      await studentRepo.save(savedStudent);
    }

    return studentRepo.findOne({
      where: { id: savedStudent.id },
      relations: ['class_section', 'class_section.class', 'guardians'],
    }) as Promise<Student>;
  }

  async findAll(query: QueryStudentDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Builds the tenant-scoped, filtered, *unpaginated* query for student
    // IDs only — deliberately not `leftJoinAndSelect`ing `guardians` here.
    // A many-to-many join used for filtering (the search's guardian
    // branch) combined with `skip`/`take` would apply `LIMIT` to the
    // flattened joined rows, not to distinct students — inflating `total`
    // and corrupting pagination whenever a matched student has more than
    // one guardian. The guardian search branch below uses an `EXISTS`
    // subquery instead, which cannot multiply rows.
    const buildIdQuery = () => {
      const qb = this.repo
        .createQueryBuilder('student')
        .select('student.id', 'id')
        .leftJoin('student.class_section', 'class_section')
        .where('student.tenant_id = :tenantId', { tenantId })
        .andWhere('student.deleted_at IS NULL');

      if (query.class_id) {
        qb.andWhere('class_section.class_id = :classId', { classId: query.class_id });
      }
      if (query.section_id) {
        qb.andWhere('student.class_section_id = :sectionId', { sectionId: query.section_id });
      }
      if (query.enrollment_status) {
        qb.andWhere('student.enrollment_status = :enrollmentStatus', {
          enrollmentStatus: query.enrollment_status,
        });
      }
      if (query.gender) {
        qb.andWhere('student.gender = :gender', { gender: query.gender });
      }
      if (query.date_of_birth_from) {
        qb.andWhere('student.date_of_birth >= :dobFrom', { dobFrom: query.date_of_birth_from });
      }
      if (query.date_of_birth_to) {
        qb.andWhere('student.date_of_birth <= :dobTo', { dobTo: query.date_of_birth_to });
      }

      // Matches GuardianService.findAll's own ILIKE/escape fix. Student has
      // no `phone` column of its own (that lives on Guardian) — name and
      // registration number are the student-owned free-text fields; roll
      // number is matched exactly (it's an int, not text) and guardians are
      // matched via the tenant-scoped EXISTS subquery below.
      const search = normalizeSearchTerm(query.search);
      if (search) {
        // `search` is already Bengali-digit-converted by
        // `normalizeSearchTerm`, so a Bengali roll number (e.g. `১০৩`)
        // matches the Latin-stored `roll_number` column.
        // `/^\d+$/`, not `Number.isInteger(Number(search))` — the latter
        // also accepts `1e5`, `0x2a`, and leading/trailing whitespace as
        // "integers", which would silently roll-number-match a plain-text
        // search term shaped like one of those.
        const isPlainInteger = /^\d+$/.test(search);
        qb.andWhere(
          new Brackets((sub) => {
            sub
              .where('student.full_name ILIKE :search', { search: `%${search}%` })
              .orWhere('student.registration_number ILIKE :search', { search: `%${search}%` });
            if (isPlainInteger) {
              sub.orWhere('student.roll_number = :rollNumber', { rollNumber: Number(search) });
            }
            // Guardian join must also carry its own tenant_id — the
            // `student_guardians` join table does not imply same-tenant.
            sub.orWhere(
              `EXISTS (
                SELECT 1 FROM student_guardians sg
                INNER JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = student.id
                  AND g.tenant_id = :tenantId
                  AND (g.full_name ILIKE :search OR g.phone ILIKE :search)
              )`,
              { search: `%${search}%` },
            );
          }),
        );
      }

      return qb;
    };

    const total = await buildIdQuery().getCount();

    // `query.sort` is already allowlisted to real columns by
    // `QueryStudentDto`'s `@IsIn` — safe to use directly. Falls back to the
    // original `created_at DESC` when the caller doesn't ask for a sort, so
    // an unsorted list page's row order doesn't change under it. `id ASC`
    // is always appended as a tiebreaker — the primary sort column alone
    // isn't unique (e.g. two students named the same, or created in the
    // same instant), and without a unique secondary key, `LIMIT`/`OFFSET`
    // pagination can return a row twice or skip one across pages when ties
    // reorder. `full_name` sorts in Bengali dictionary order via
    // `BN_COLLATION` rather than libc byte order.
    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(
        `student.full_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else if (query.sort === 'registration_number') {
      idQb.orderBy('student.registration_number', query.order === 'desc' ? 'DESC' : 'ASC');
    } else {
      idQb.orderBy('student.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    idQb.addOrderBy('student.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    // Second query hydrates full entities (with relations) for exactly
    // this page's IDs — this join *can* multiply rows across guardians,
    // but there's no pagination applied here for it to corrupt.
    const rows = await this.repo.find({
      // `tenant_id` is redundant here — `ids` already came from the
      // tenant-scoped ID query above — but it costs nothing and keeps this
      // query tenant-scoped on its own terms rather than only by
      // construction, per the multi-tenancy skill's "new query" checklist.
      where: { id: In(ids), tenant_id: tenantId },
      relations: ['class_section', 'class_section.class', 'guardians'],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is Student => row != null);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Student> {
    const student = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class', 'guardians'],
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${id}" not found`);
    }
    return student;
  }

  /**
   * Loads several students with their guardians in one query, scoped to the
   * tenant. IDs that don't resolve are simply absent from the result — the
   * caller decides whether a missing student is an error, since "some of
   * these IDs are bad" and "this one ID is bad" want different responses.
   *
   * Exists so bulk flows (fee reminders) don't issue one findOne per student.
   */
  async findManyWithGuardians(ids: string[], tenantId: string): Promise<Student[]> {
    if (ids.length === 0) return [];
    return this.repo.find({
      where: { id: In(ids), tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['guardians'],
    });
  }

  async update(id: string, dto: UpdateStudentDto, tenantId: string): Promise<Student> {
    await this.findOne(id, tenantId);

    // Validate class_section_id belongs to tenant if provided
    if (dto.class_section_id) {
      const section = await this.sectionRepo.findOne({
        where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!section) {
        throw new NotFoundException(`Class section with ID "${dto.class_section_id}" not found`);
      }
    }

    const updateData: any = { ...dto };
    if (dto.date_of_birth) {
      updateData.date_of_birth = new Date(dto.date_of_birth);
    }
    if (dto.guardian_ids !== undefined) {
      delete updateData.guardian_ids;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    // Replace guardian links if provided
    if (dto.guardian_ids !== undefined) {
      const student = await this.findOne(id, tenantId);
      if (dto.guardian_ids.length > 0) {
        const guardians = await this.guardianRepo.find({
          where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (guardians.length !== dto.guardian_ids.length) {
          throw new NotFoundException('One or more guardian IDs not found');
        }
        student.guardians = guardians;
      } else {
        student.guardians = [];
      }
      await this.repo.save(student);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}

@Injectable()
export class GuardianService {
  constructor(
    @InjectRepository(Guardian)
    private readonly repo: Repository<Guardian>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /**
   * @param manager Optional transaction-scoped manager — see StudentService.create.
   */
  async create(
    dto: CreateGuardianDto,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Guardian> {
    const repo = manager ? manager.getRepository(Guardian) : this.repo;
    const studentRepo = manager ? manager.getRepository(Student) : this.studentRepo;

    const entity = repo.create({
      full_name: dto.full_name,
      relationship: dto.relationship ?? 'OTHER',
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      alternate_phone: dto.alternate_phone ?? null,
      address: dto.address ?? null,
      occupation: dto.occupation ?? null,
      preferred_communication: dto.preferred_communication,
      tenant_id: tenantId,
    });

    const saved = await repo.save(entity);

    // Link students if provided
    if (dto.student_ids?.length) {
      const students = await studentRepo.find({
        where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (students.length !== dto.student_ids.length) {
        throw new NotFoundException('One or more student IDs not found');
      }
      saved.students = students;
      await repo.save(saved);
    }

    return repo.findOne({
      where: { id: saved.id },
      relations: ['students'],
    }) as Promise<Guardian>;
  }

  async findAll(query: QueryGuardianDto, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Two-phase (IDs, then hydrate) — see the identical comment on
    // StudentService.findAll / FeeStructureService.findAll. TypeORM's
    // pagination-with-joins path can't resolve a `COLLATE`-suffixed
    // `orderBy` expression, and `guardian.students` is many-to-many, so a
    // single joined query would also inflate `total` under `skip`/`take`.
    const buildIdQuery = () => {
      const qb = this.repo
        .createQueryBuilder('guardian')
        .select('guardian.id', 'id')
        .where('guardian.tenant_id = :tenantId', { tenantId })
        .andWhere('guardian.deleted_at IS NULL');

      const search = normalizeSearchTerm(query.search);
      if (search) {
        // Fixed to ILIKE (was Like — case-sensitive, so "rahim" missed "Rahim").
        qb.andWhere(
          '(guardian.full_name ILIKE :search OR guardian.phone ILIKE :search OR guardian.email ILIKE :search)',
          { search: `%${search}%` },
        );
      }
      if (query.relationship) {
        qb.andWhere('guardian.relationship = :relationship', {
          relationship: query.relationship,
        });
      }
      if (query.preferred_communication) {
        qb.andWhere('guardian.preferred_communication = :preferredCommunication', {
          preferredCommunication: query.preferred_communication,
        });
      }
      if (query.is_primary_contact !== undefined) {
        qb.andWhere('guardian.is_primary_contact = :isPrimaryContact', {
          isPrimaryContact: query.is_primary_contact,
        });
      }

      return qb;
    };

    const total = await buildIdQuery().getCount();

    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(
        `guardian.full_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else {
      idQb.orderBy('guardian.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    idQb.addOrderBy('guardian.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const rows = await this.repo.find({
      // `tenant_id` is redundant here — `ids` already came from the
      // tenant-scoped ID query above — but it costs nothing and keeps this
      // query tenant-scoped on its own terms rather than only by
      // construction, per the multi-tenancy skill's "new query" checklist.
      where: { id: In(ids), tenant_id: tenantId },
      relations: ['students'],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is Guardian => row != null);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students', 'students.class_section', 'students.class_section.class'],
    });
    if (!guardian) {
      throw new NotFoundException(`Guardian with ID "${id}" not found`);
    }
    return guardian;
  }

  async findByPhone(
    phone: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Guardian | null> {
    const repo = manager ? manager.getRepository(Guardian) : this.repo;
    return repo.findOne({ where: { phone, tenant_id: tenantId, deleted_at: IsNull() } });
  }

  /**
   * The guardian row linked to this user account, in this tenant.
   * `Guardian.user_id` is a unique one-to-one, so this is exact ownership —
   * no FamilyAccessService indirection needed (that models user → student). [5.4a]
   */
  async findOwn(userId: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { user_id: userId, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students', 'students.class_section', 'students.class_section.class'],
    });
    if (!guardian) {
      throw new NotFoundException('No guardian record is linked to your account');
    }
    return guardian;
  }

  /** Self-service contact-detail edit. Ownership comes from the JWT sub, never a path id. */
  async updateOwn(userId: string, dto: UpdateOwnGuardianDto, tenantId: string): Promise<Guardian> {
    const guardian = await this.findOwn(userId, tenantId);

    const updateData: any = { ...dto };
    // `''` means "clear this column" — store a real NULL, as update() does.
    for (const key of ['phone', 'email', 'alternate_phone'] as const) {
      if (updateData[key] === '') updateData[key] = null;
    }

    if (Object.keys(updateData).length > 0) {
      // tenant_id stays in the criteria so this can never touch another
      // tenant's row even if ids were to collide.
      await this.repo.update({ id: guardian.id, tenant_id: tenantId }, updateData);
    }

    return this.findOne(guardian.id, tenantId);
  }

  async update(id: string, dto: UpdateGuardianDto, tenantId: string): Promise<Guardian> {
    await this.findOne(id, tenantId);

    const updateData: any = { ...dto };
    if (dto.student_ids !== undefined) {
      delete updateData.student_ids;
    }

    // The edit-guardian dialog sends `''` (not an omitted key) to
    // explicitly clear one of these nullable columns — store that as a
    // real NULL rather than a stray empty string sitting in the column.
    for (const key of ['phone', 'email', 'alternate_phone', 'address', 'occupation'] as const) {
      if (updateData[key] === '') updateData[key] = null;
    }

    await this.repo.update({ id, tenant_id: tenantId }, updateData);

    // Replace student links if provided
    if (dto.student_ids !== undefined) {
      const guardian = await this.findOne(id, tenantId);
      if (dto.student_ids.length > 0) {
        const students = await this.studentRepo.find({
          where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (students.length !== dto.student_ids.length) {
          throw new NotFoundException('One or more student IDs not found');
        }
        guardian.students = students;
      } else {
        guardian.students = [];
      }
      await this.repo.save(guardian);
    }

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.repo.softDelete({ id, tenant_id: tenantId });
  }
}
