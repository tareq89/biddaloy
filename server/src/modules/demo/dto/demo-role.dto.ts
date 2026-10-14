import { ApiProperty } from '@nestjs/swagger';

export class DemoRoleDto {
  @ApiProperty() key!: string;
  @ApiProperty() role!: string;
  @ApiProperty() email!: string;
  @ApiProperty() branchSlug!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty() nameBn!: string;
  @ApiProperty() tryKey!: string;
}

export class DemoRolesResponseDto {
  @ApiProperty({ description: 'Shared password of every demo login.' })
  password!: string;

  @ApiProperty({ type: [DemoRoleDto] })
  cards!: DemoRoleDto[];
}
