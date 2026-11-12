import { ApiProperty } from '@nestjs/swagger';

export class AdminResetLinkResponseDto {
  @ApiProperty({ enum: ['SMS', 'EMAIL'] }) channel: 'SMS' | 'EMAIL';
  @ApiProperty() expiresAt: string;
}

export class LogoutAllResponseDto {
  /** Counts shared identities too: tokens are per user, so a person in two schools is signed out of both. */
  @ApiProperty() usersSignedOut: number;
}
