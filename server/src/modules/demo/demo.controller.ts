import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Demo role cards and the shared demo password (404 outside the demo).' })
  @ApiOkResponse({ type: DemoRolesResponseDto })
  roles(): DemoRolesResponseDto {
    if (this.config.get<string>('DEMO_MODE') !== 'true') throw new NotFoundException();
    return {
      password: this.config.get<string>('DEMO_PASSWORD') ?? '',
      cards: DEMO_CARDS.map((c) => ({ ...c })),
    };
  }
}
