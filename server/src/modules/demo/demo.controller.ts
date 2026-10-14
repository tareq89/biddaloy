import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DEMO_CARDS } from './demo-accounts';
import { DemoRolesResponseDto } from './dto/demo-role.dto';

/**
 * Public on purpose: the login screen reads the role cards before anyone is signed in. The
 * password is the one shared demo password (D30); a card signs in through the normal /auth/login.
 */
@ApiTags('demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly config: ConfigService) {}

  @Get('roles')
  @ApiOperation({
    summary: 'Demo role cards and the shared demo password (`enabled: false` outside the demo).',
  })
  @ApiOkResponse({ type: DemoRolesResponseDto })
  @ApiNotFoundResponse({ description: 'Not running in demo mode.' })
  roles(): DemoRolesResponseDto {
    // 200 either way: every login page and shell asks this, and a 404 logs a console error on
    // every page load of a real school.
    if (this.config.get<string>('DEMO_MODE') !== 'true') {
      return { enabled: false, password: '', cards: [] };
    }
    return {
      enabled: true,
      password: this.config.get<string>('DEMO_PASSWORD') ?? '',
      cards: DEMO_CARDS.map((c) => ({ ...c })),
    };
  }
}
