import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isEmail } from 'class-validator';
import { AuditAction, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { User } from './entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { InvitationService } from '../account-access/invitation.service';
import { normalizeEmail } from '../auth/normalize-identifier';
import { UserService, TeacherService } from './users.service';
import { INTERNATIONAL_PHONE_REGEX, CreateUserDto } from './dto/users.dto';
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
    const membershipByUser = new Map(memberships.map((m) => [m.user_id, m]));

    const errors: BulkImportErrorDto[] = [];
    const staged: StagedRow[] = [];
    const preview: StaffImportPreviewRowDto[] = [];
    const seen = new Set<string>();

    for (const { rowNumber, values: v } of parsed) {
      const rowErrors: { column: string | null; value?: string; message: string }[] = [];
      const err = (column: string | null, message: string, value?: string) =>
        rowErrors.push({ column, message, value: value || undefined });
      const notes: string[] = [];

      if (!v.name) err('name', 'Name is required');
      if (!v.mobile && !v.email) err(null, 'Give a mobile number or an email');
      if (v.mobile && !INTERNATIONAL_PHONE_REGEX.test(v.mobile)) {
        err('mobile', 'Invalid mobile number', v.mobile);
      }
      if (v.email && !isEmail(v.email)) err('email', 'Invalid email address', v.email);
      const role = parseRole(v.role);
      if (!role) err('role', 'Unknown role, or a role that cannot be imported', v.role);

      const email = v.email && isEmail(v.email) ? normalizeEmail(v.email) : undefined;
      const phone = v.mobile && INTERNATIONAL_PHONE_REGEX.test(v.mobile) ? v.mobile : undefined;
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
        const membership = membershipByUser.get(user.id);
        if (user.deleted_at || !membership) {
          // Deliberately vague: do not reveal which other school holds this identifier.
          err(null, 'This email or mobile number is already used by another account');
        } else if (membership.deleted_at) {
          action = 'restore';
          userId = user.id;
          notes.push('Former member — will be restored');
        } else {
          action = 'skip';
          notes.push('Already a member — skipped');
        }
      }

      let designation: TeacherDesignation | undefined;
      if (v.designation && role === UserRole.TEACHER) {
        designation = parseDesignation(v.designation);
        if (!designation) notes.push(`Unknown designation "${v.designation}" — left empty`);
      }

      for (const e of rowErrors) {
        errors.push({ row: rowNumber, tab: undefined, severity: 'error', ...e });
      }
      if (rowErrors.length || !role) continue;

      staged.push({
        rowNumber,
        name: v.name,
        email,
        phone,
        role,
        designation,
        action,
        userId,
      });
      preview.push({
        row: rowNumber,
        name: v.name,
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
    };
    for (const row of stage.rows) {
      try {
        if (row.action === 'skip') {
          result.skipped++;
        } else if (row.action === 'restore') {
          await this.userService.restore(row.userId as string, tenantId, actorId);
          result.restored++;
        } else {
          await this.createRow(row, tenantId, actorId, dto.send_invitations, result);
        }
      } catch (err) {
        result.failed.push({
          row: row.rowNumber,
          reason: err instanceof Error ? err.message : String(err),
        });
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
      },
    });
    return result;
  }

  private async createRow(
    row: StagedRow,
    tenantId: string,
    actorId: string,
    invite: boolean,
    result: StaffImportResultDto,
  ): Promise<void> {
    // No password: members arrive through an invitation or code sign-in.
    const { user } = await this.userService.create(
      { email: row.email, phone: row.phone, full_name: row.name, role: row.role } as CreateUserDto,
      tenantId,
    );
    result.created++;
    if (row.role === UserRole.TEACHER) {
      // Same path as `POST /teachers`; the employee id is generated.
      await this.teacherService.create(
        { user_id: user.id, designations: row.designation ? [row.designation] : [] },
        tenantId,
      );
    }
    if (invite) {
      await this.invitations.issueAndSend({ userId: user.id, tenantId, actorUserId: actorId });
      result.invited++;
    }
  }
}
