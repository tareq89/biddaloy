import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, UserRole } from '@biddaloy/shared';
import type { PresetPack, PresetStatus, PresetSummary } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { PresetRegistryService } from './preset-registry.service';
import { PresetStatusService } from './preset-status.service';

/** What the wizard shows for a pack. Never the raw pack. */
export interface PresetPreview {
  summary: PresetSummary;
  stages: PresetPack['stages'];
  versions: NonNullable<PresetPack['versions']>;
  classes: PresetPack['classes'];
  subjects: PresetPack['subjects'];
  groups: string[];
  gradingScale: PresetPack['gradingScale'];
  terms: PresetPack['terms'];
  examTemplates: { name: string; rowCount: number }[];
  certificates: PresetPack['certificates'];
  counts: {
    stages: number;
    classes: number;
    subjects: number;
    classSubjects: number;
    terms: number;
    examTemplates: number;
  };
}

@ApiTags('presets')
@ApiTenantAuth()
@Controller('presets')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class PresetsController {
  constructor(
    private readonly registry: PresetRegistryService,
    private readonly status: PresetStatusService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CURRICULUM_PRESET_APPLY)
  @ApiOperation({ summary: 'List available curriculum presets.' })
  list(): PresetSummary[] {
    return this.registry.list();
  }

  // Declared before `:id` so "status" is not read as an id.
  @Get('status')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CURRICULUM_PRESET_APPLY)
  @ApiOperation({
    summary: 'Whether this school can apply a preset (AVAILABLE / APPLIED / CUSTOM).',
  })
  getStatus(@CurrentTenant() tenant: { id: string }): Promise<PresetStatus> {
    return this.status.status(tenant.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.CURRICULUM_PRESET_APPLY)
  @ApiOperation({
    summary: 'Preview one preset pack (clients URL-encode the slash in ids like bd/nctb).',
  })
  preview(@Param('id') id: string): PresetPreview {
    const p = this.registry.get(id);
    const [summary] = this.registry.list().filter((s) => s.id === p.id);
    return {
      summary,
      stages: p.stages,
      versions: p.versions ?? [],
      classes: p.classes,
      subjects: p.subjects,
      groups: p.groups,
      gradingScale: p.gradingScale,
      terms: p.terms,
      examTemplates: p.examTemplates.map((t) => ({ name: t.name, rowCount: t.rows.length })),
      certificates: p.certificates,
      counts: {
        stages: p.stages.length,
        classes: p.classes.length,
        subjects: p.subjects.length,
        classSubjects: p.classSubjects.length,
        terms: p.terms.length,
        examTemplates: p.examTemplates.length,
      },
    };
  }
}
