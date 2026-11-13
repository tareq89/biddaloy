import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, ValidateIf } from 'class-validator';

/** [77.6.01] Body of PUT /platform/modules. The map is checked in the service (fixed 400 text). */
export class PlatformModulesDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Module key to false (off for every school). An absent key is on.',
  })
  @IsObject({ message: 'modules must be an object of true or false per module' })
  modules: Record<string, boolean>;
}

export class PlatformModulesResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  modules: Record<string, boolean>;
}

/** [77.6.01] Body of PUT /platform/schools/:id/modules/:key/lock. `null` hands control back. */
export class ModuleLockDto {
  @ApiProperty({ enum: ['on', 'off'], nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsIn(['on', 'off'], { message: 'lock must be on, off or null' })
  lock: 'on' | 'off' | null;
}

export class ModuleLockResponseDto {
  @ApiProperty() key: string;
  @ApiProperty({ enum: ['on', 'off'], nullable: true }) lock: 'on' | 'off' | null;
}
