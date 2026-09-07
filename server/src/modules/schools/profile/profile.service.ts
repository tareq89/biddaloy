import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { UpdateSchoolProfileDto } from './dto/update-school-profile.dto';
import { AuditService } from '../../audit/audit.service';
import { RequestContext } from '../../../common/request-context.util';

/** The six text fields [15.5.2] exposes on the profile — used both for the
 * GET response shape and to compute the changed-fields audit diff. */
const PROFILE_FIELDS = ['name', 'name_bn', 'address', 'phone', 'email', 'registration_id'] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

export type SchoolProfileView = {
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  logo_url: string | null;
};

/** `logo_url` is `/schools/<id>/logo?v=<key-uuid>` — the query param is
 * whatever's after the last `/` in `logo_key`, minus its extension, so a
 * fresh upload (new key) naturally busts any browser cache of the old
 * bytes. Served by [15.5.4]. */
function buildLogoUrl(schoolId: string, logoKey: string | null): string | null {
  if (!logoKey) return null;
  const filename = logoKey.split('/').pop() ?? '';
  const version = filename.replace(/\.[^.]+$/, '');
  return `/schools/${schoolId}/logo?v=${version}`;
}

function toProfileView(school: School): SchoolProfileView {
  return {
    name: school.name,
    name_bn: school.name_bn,
    address: school.address,
    phone: school.phone,
    email: school.email,
    registration_id: school.registration_id,
    logo_url: buildLogoUrl(school.id, school.logo_key),
  };
}

@Injectable()
export class SchoolProfileService {
  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    private readonly auditService: AuditService,
  ) {}

  async getProfile(schoolId: string): Promise<SchoolProfileView> {
    const school = await this.repo.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(`School with ID "${schoolId}" not found`);
    }
    return toProfileView(school);
  }

  async updateProfile(
    schoolId: string,
    dto: UpdateSchoolProfileDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SchoolProfileView> {
    const school = await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const current = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!current) {
        throw new NotFoundException(`School with ID "${schoolId}" not found`);
      }

      const oldValues: Partial<Record<ProfileField, unknown>> = {};
      const newValues: Partial<Record<ProfileField, unknown>> = {};

      for (const field of PROFILE_FIELDS) {
        const nextValue = (dto as Record<ProfileField, unknown>)[field];
        // Class fields (even undeclared ones) may exist as own properties
        // set to `undefined` depending on TS's class-fields output — check
        // the value, not `in`, so an omitted field is truly skipped.
        if (nextValue === undefined) continue;
        if (current[field] === nextValue) continue;
        oldValues[field] = current[field];
        newValues[field] = nextValue;
        (current[field] as unknown) = nextValue;
      }

      const saved = await schoolRepo.save(current);

      if (Object.keys(newValues).length > 0) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'School',
            entity_id: schoolId,
            tenant_id: schoolId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: newValues,
          },
          manager,
        );
      }

      return saved;
    });

    return toProfileView(school);
  }
}
