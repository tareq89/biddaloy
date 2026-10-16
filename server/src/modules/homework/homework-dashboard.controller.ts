import { Controller, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { SyllabusService } from './syllabus.service';
import { HomeworkService } from './homework.service';
import { HomeworkAnalyticsService } from './homework-analytics.service';
import { StudyPlanDashboardService } from '../study-plans/study-plan-dashboard.service';
import {
  HomeworkSubmissionRateDto,
  HomeworkToCheckDto,
  LessonsToMarkDto,
  MySyllabusProgressDto,
  SyllabusProgressWidgetDto,
  SyllabusVsPlanDto,
} from './dto/homework-dashboard.dto';

/** [8.10.7.2.05] "Syllabus progress" widget. Done % plus the study plan's expected-by-today (null without a plan). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class HomeworkDashboardController {
  constructor(
    private readonly syllabus: SyllabusService,
    private readonly homework: HomeworkService,
    private readonly analytics: HomeworkAnalyticsService,
    private readonly cache: DashboardCacheService,
    private readonly planDashboard: StudyPlanDashboardService,
  ) {}

  @DashboardWidgetRoute(DashboardWidgetKey.SYLLABUS_PROGRESS)
  @ApiOkResponse({ type: SyllabusProgressWidgetDto })
  getSyllabusProgress(@CurrentTenant() tenant: { id: string }): Promise<SyllabusProgressWidgetDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.SYLLABUS_PROGRESS, 'school', () =>
      this.syllabus.progressByClass(tenant.id),
    );
  }

  /** [8.10.7.7.04] ADMIN card: taught vs the study plan, per class. */
  @DashboardWidgetRoute(DashboardWidgetKey.SYLLABUS_VS_PLAN)
  @ApiOkResponse({ type: SyllabusVsPlanDto })
  getSyllabusVsPlan(@CurrentTenant() tenant: { id: string }): Promise<SyllabusVsPlanDto> {
    return this.cache.getOrLoad(tenant.id, DashboardWidgetKey.SYLLABUS_VS_PLAN, 'school', () =>
      this.syllabus.syllabusVsPlan(tenant.id),
    );
  }

  /** [8.10.7.3.04] Teacher card "homework to check". Cached per user. */
  @DashboardWidgetRoute(DashboardWidgetKey.HOMEWORK_TO_CHECK)
  @ApiOkResponse({ type: HomeworkToCheckDto })
  getHomeworkToCheck(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ): Promise<HomeworkToCheckDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.HOMEWORK_TO_CHECK,
      `user:${user.sub}`,
      () =>
        this.homework.submissionsToCheck({
          role: tenant.role,
          userId: user.sub,
          tenantId: tenant.id,
        }),
    );
  }

  /** [8.10.7.3.19] ADMIN card: submitted vs assigned, last 7 days. */
  @DashboardWidgetRoute(DashboardWidgetKey.HOMEWORK_SUBMISSION_RATE)
  @ApiOkResponse({ type: HomeworkSubmissionRateDto })
  getSubmissionRate(@CurrentTenant() tenant: { id: string }): Promise<HomeworkSubmissionRateDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.HOMEWORK_SUBMISSION_RATE,
      'school',
      () => this.analytics.getSubmissionRateByClass(tenant.id),
    );
  }

  /** [8.10.7.3.19] Teacher card "my syllabus progress". Cached per user. */
  @DashboardWidgetRoute(DashboardWidgetKey.MY_SYLLABUS_PROGRESS)
  @ApiOkResponse({ type: MySyllabusProgressDto })
  getMySyllabusProgress(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<MySyllabusProgressDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.MY_SYLLABUS_PROGRESS,
      `user:${user.sub}`,
      () => this.analytics.getTeacherSyllabusProgress(tenant.id, user.sub),
    );
  }

  /** [8.10.7.7.05] Teacher card "lessons to mark". Cached per user (own routine only). */
  @DashboardWidgetRoute(DashboardWidgetKey.MY_LESSONS_TO_MARK)
  @ApiOkResponse({ type: LessonsToMarkDto })
  getMyLessonsToMark(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<LessonsToMarkDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.MY_LESSONS_TO_MARK,
      `user:${user.sub}`,
      () => this.planDashboard.lessonsToMark(tenant.id, user.sub),
    );
  }
}
