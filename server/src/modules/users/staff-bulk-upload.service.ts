import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { isEmail, validate } from 'class-validator';
import { AuditAction, isStaffRole, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { InvitationService } from '../account-access/invitation.service';
import { normalizeEmail } from '../auth/normalize-identifier';
import { UserService, TeacherService } from './users.service';
import { CreateUserDto } from './dto/users.dto';
import {
  StaffImportCommitDto,
  StaffImportPreviewRowDto,
  StaffImportResultDto,
  StaffImportValidateResultDto,
} from './dto/staff-bulk-upload.dto';
import {
  StaffUploadParseError,
  parseDesignation,
  parseRole,
  parseStaffSpreadsheet,
} from './staff-bulk-upload.parser';

/** Plain JSON only — this round-trips through Redis. */
interface StagedRow {
  rowNumber: number;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  designation?: TeacherDesignation;
  action: 'create' | 'restore' | 'skip';
  /** Set for `restore` (the existing account). */
  userId?: string;
}

interface StagedImport {
  filename: string;
  rows: StagedRow[];
  hardErrorCount: number;
}

@Injectable()
export class StaffBulkUploadService {
  private readonly logger = new Logger(StaffBulkUploadService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserTenant) private readonly userTenantRepo: Repository<UserTenant>,
    private readonly userService: UserService,
    private readonly teacherService: TeacherService,
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
  ) {}

  /** Checks the whole file and stages it. Writes no tenant data. */
  async validate(
    file: Express.Multer.File,
    tenantId: string,
    actorId: string,
  ): Promise<StaffImportValidateResultDto> {
    let parsed;
    try {
      parsed = await parseStaffSpreadsheet(file.buffer, file.originalname);
    } catch (err) {
      if (err instanceof StaffUploadParseError) throw new BadRequestException(err.message);
      throw err;
    }

    // Accounts are global (email/phone are unique across schools), so the lookup is by
    // identifier; what the file may do with a hit depends on THIS tenant's membership.
    const emails = parsed
      .map((r) => r.values.email)
      .filter((e) => isEmail(e))
      .map(normalizeEmail);
    const phones = parsed.map((r) => r.values.mobile).filter(Boolean);
    const users = await this.userRepo.find({
      where: [
        ...(emails.length ? [{ email: In(emails) }] : []),
        ...(phones.length ? [{ phone: In(phones) }] : []),
      ],
      withDeleted: true,
    });
    const memberships = users.length
      ? await this.userTenantRepo.find({
          where: { tenant_id: tenantId, user_id: In(users.map((u) => u.id)) },
          withDeleted: true,
        })
      : [];
    const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email as string, u]));
    const byPhone = new Map(users.filter((u) => u.phone).map((u) => [u.phone as string, u]));
    // One user can hold several roles here (e.g. PARENT + a former TEACHER): decide per role.
    const rolesByUser = new Map<string, { active: Set<UserRole>; former: Set<UserRole> }>();
    for (const m of memberships) {
      const e = rolesByUser.get(m.user_id) ?? { active: new Set(), former: new Set() };
      (m.deleted_at ? e.former : e.active).add(m.role);
      rolesByUser.set(m.user_id, e);
    }

    const errors: BulkImportErrorDto[] = [];
    const staged: StagedRow[] = [];
    const preview: StaffImportPreviewRowDto[] = [];
    const seen = new Set<string>();

    for (const { rowNumber, values: v, numericMobile } of parsed) {
      const rowErrors: { column: string | null; value?: string; message: string }[] = [];
      const err = (column: string | null, message: string, value?: string) =>
        rowErrors.push({ column, message, value: value || undefined });
      const notes: string[] = [];

      const role = parseRole(v.role);
      if (!role) err('role', 'Unknown role, or a role that cannot be imported', v.role);
      if (!v.name) err('name', 'Name is required');
      if (!v.mobile && !v.email) err(null, 'Give a mobile number or an email');
      if (numericMobile) {
        err(
          'mobile',
          "Mobile was typed as a number, so a leading 0 may be lost. Format the column as Text and re-type it, e.g. '01711000101'",
          v.mobile,
        );
      }

      // The real DTO rules (sanitising, max lengths, formats): the same ones POST /users enforces.
      const dto = plainToInstance(CreateUserDto, {
        full_name: v.name,
        email: v.email || undefined,
        phone: v.mobile || undefined,
        role: role ?? UserRole.TEACHER,
        tenantId,
      });
      const COLUMN: Record<string, string> = { full_name: 'name', phone: 'mobile', email: 'email' };
      const raw: Record<string, string> = { full_name: v.name, phone: v.mobile, email: v.email };
      const invalid = new Set<string>();
      for (const e of await validate(dto)) {
        if (!COLUMN[e.property]) continue;
        invalid.add(e.property);
        err(COLUMN[e.property], Object.values(e.constraints ?? {}).join('; '), raw[e.property]);
      }

      const email = dto.email && !invalid.has('email') ? normalizeEmail(dto.email) : undefined;
      const phone = dto.phone && !invalid.has('phone') && !numericMobile ? dto.phone : undefined;
      for (const [column, id] of [
        ['email', email],
        ['mobile', phone],
      ] as const) {
        if (!id) continue;
        if (seen.has(`${column}:${id}`)) err(column, 'Appears more than once in this file', id);
        seen.add(`${column}:${id}`);
      }

      let action: StagedRow['action'] = 'create';
      let userId: string | undefined;
      const hitA = email ? byEmail.get(email) : undefined;
      const hitB = phone ? byPhone.get(phone) : undefined;
      if (hitA && hitB && hitA.id !== hitB.id) {
        err(null, 'The email and the mobile number belong to two different accounts');
      } else if (hitA || hitB) {
        const user = (hitA ?? hitB) as User;
        const roles = rolesByUser.get(user.id);
        if (user.deleted_at || !roles) {
          // Deliberately vague: do not reveal which other school holds this identifier.
          err(null, 'This email or mobile number is already used by another account');
        } else if (role && roles.active.has(role)) {
          action = 'skip';
          notes.push('Already a member — skipped');
        } else if (role && roles.former.has(role) && ![...roles.active].some(isStaffRole)) {
          action = 'restore';
          userId = user.id;
          notes.push(`Former ${role} — this role will be restored`);
        } else {
          const have = [...roles.active, ...roles.former].join(', ');
          err(
            'role',
            `This person is already in this school as ${have}; the import does not change roles`,
            v.role,
          );
        }
      }

      let designation: TeacherDesignation | undefined;
      if (v.designation && role === UserRole.TEACHER) {
        designation = parseDesignation(v.designation);
        if (!designation) notes.push(`Unknown designation "${v.designation}" — left empty`);
      } else if (v.designation) {
        notes.push('Designation is only used for teachers — ignored');
      }

      for (const e of rowErrors) {
        errors.push({ row: rowNumber, tab: undefined, severity: 'error', ...e });
      }
      if (rowErrors.length || !role) continue;

      staged.push({
        rowNumber,
        name: dto.full_name,
        email,
        phone,
        role,
        designation,
        action,
        userId,
      });
      preview.push({
        row: rowNumber,
        name: dto.full_name,
        mobile: phone,
        email,
        role,
        designation,
        action,
        notes,
      });
    }

    const { stagingId, expiresAt } = await this.staging.stage<StagedImport>(tenantId, actorId, {
      filename: file.originalname,
      rows: staged,
      hardErrorCount: errors.length,
    });
    const count = (a: StagedRow['action']) => staged.filter((r) => r.action === a).length;
    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      summary: { create: count('create'), restore: count('restore'), skip: count('skip') },
      rows: preview,
      errors,
      hard_error_count: errors.length,
    };
  }

  /** Consumes the stage once. One failed row never stops the others. */
  async commit(
    dto: StaffImportCommitDto,
    tenantId: string,
    actorId: string,
  ): Promise<StaffImportResultDto> {
    const stage = await this.staging.consume<StagedImport>(tenantId, actorId, dto.staging_id);
    if (!stage) {
      throw new NotFoundException(
        'No staged upload found for this id. It may have expired or already been committed.',
      );
    }
    if (stage.hardErrorCount > 0) {
      throw new ConflictException(
        'This staged upload had validation errors and cannot be committed. Re-validate the file first.',
      );
    }

    const result: StaffImportResultDto = {
      created: 0,
      restored: 0,
      skipped: 0,
      invited: 0,
      failed: [],
      invite_failed: [],
    };
    const createdUserIds: string[] = [];
    for (const row of stage.rows) {
      try {
        if (row.action === 'skip') {
          result.skipped++;
        } else if (row.action === 'restore') {
          await this.userService.restore(row.userId as string, tenantId, actorId, row.role);
          result.restored++;
        } else {
          const userId = await this.createRow(row, tenantId);
          result.created++; // counted only after the row's transaction committed
          createdUserIds.push(userId);
          if (dto.send_invitations) await this.invite(row, userId, tenantId, actorId, result);
        }
      } catch (err) {
        result.failed.push({ row: row.rowNumber, reason: this.reason(err) });
      }
    }

    await this.audit.record({
      action: AuditAction.BULK_UPLOAD,
      entity_type: 'Membership',
      tenant_id: tenantId,
      performed_by_user_id: actorId,
      new_values: {
        filename: stage.filename,
        total_rows: stage.rows.length,
        created: result.created,
        restored: result.restored,
        skipped: result.skipped,
        failed: result.failed.length,
        created_user_ids: createdUserIds,
        failed_rows: result.failed.map((f) => f.row),
      },
    });
    return result;
  }

  /** User + membership (+ teacher profile) in ONE transaction: a failed step leaves nothing behind. */
  private createRow(row: StagedRow, tenantId: string): Promise<string> {
    return this.userRepo.manager.transaction(async (manager) => {
      // No password: members arrive through an invitation or code sign-in.
      const { user } = await this.userService.create(
        {
          email: row.email,
          phone: row.phone,
          full_name: row.name,
          role: row.role,
        } as CreateUserDto,
        tenantId,
        manager,
      );
      if (row.role === UserRole.TEACHER) {
        // Same path as `POST /teachers`; the employee id is generated.
        await this.teacherService.create(
          { user_id: user.id, designations: row.designation ? [row.designation] : [] },
          tenantId,
          manager,
        );
      }
      return user.id;
    });
  }

  /** The member already exists, so a failed send is reported separately, not as a failed row. */
  private async invite(
    row: StagedRow,
    userId: string,
    tenantId: string,
    actorId: string,
    result: StaffImportResultDto,
  ): Promise<void> {
    try {
      // `issueAndSend` reports delivery trouble as a FAILED status instead of throwing.
      const sent = await this.invitations.issueAndSend({ userId, tenantId, actorUserId: actorId });
      if (sent.status === 'FAILED') {
        result.invite_failed.push({
          row: row.rowNumber,
          reason: 'The invitation could not be delivered',
        });
      } else {
        result.invited++;
      }
    } catch (err) {
      result.invite_failed.push({ row: row.rowNumber, reason: this.reason(err) });
    }
  }

  /** Only deliberate HTTP errors carry text meant for the admin; anything else may name DB internals. */
  private reason(err: unknown): string {
    if (err instanceof HttpException) return err.message;
    this.logger.error(`Staff import row failed: ${err instanceof Error ? err.message : err}`);
    return 'Could not save this row';
  }
}
