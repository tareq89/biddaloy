import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/** Stub for [17.1.2] — routes reading/writing `region.calendar` tenant
 * settings (`CalendarSettings`, [17.1.1]). Filled in by a wave-2 lane. */
@ApiTags('calendar-settings')
@Controller('calendar-settings')
export class CalendarSettingsController {}
