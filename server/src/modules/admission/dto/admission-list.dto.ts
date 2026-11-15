import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdmissionListOrder } from '@biddaloy/shared';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';

export const MAX_LIST_CAPACITY = 100000;
export const MAX_LIST_IDS = 1000;
const LIST_ORDERS = Object.values(AdmissionListOrder);

export class ListFilterDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  quota_tags?: string[];

  @ApiPropertyOptional({ example: 60.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999.99)
  min_score?: number;

  @ApiPropertyOptional({ example: 'FEMALE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;
}

export class CreateMeritListDto {
  @ApiProperty({ example: 40, description: 'Seats this list offers.' })
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_CAPACITY)
  capacity: number;

  @ApiProperty({ example: '2026-12-20', description: 'Offers lapse after this day (YYYY-MM-DD).' })
  @IsRealDate()
  act_by_date: string;
}

export class CreateWaitingListDto extends CreateMeritListDto {
  @ApiProperty({ enum: LIST_ORDERS, enumName: 'AdmissionListOrder' })
  @IsIn(LIST_ORDERS)
  order: AdmissionListOrder;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required for MANUAL: the order is the list.',
  })
  @ValidateIf(
    (o: CreateWaitingListDto) =>
      o.order === AdmissionListOrder.MANUAL || o.applicant_ids !== undefined,
  )
  @IsArray()
  @ArrayMaxSize(MAX_LIST_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  applicant_ids?: string[];

  @ApiPropertyOptional({ type: ListFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ListFilterDto)
  filter?: ListFilterDto;
}

export class PatchMembersDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  add?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  remove?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Applicant ids in the new order; must be every current member.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LIST_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  order?: string[];
}

export class ListMemberDto {
  @ApiProperty({ format: 'uuid' }) applicant_id: string;
  @ApiProperty() applicant_name: string;
  @ApiProperty() position: number;
  @ApiProperty() status: string;
}

export class ListCountsDto {
  @ApiProperty() OFFERED: number;
  @ApiProperty() WAITING: number;
  @ApiProperty() ADMITTED: number;
  @ApiProperty() EXPIRED: number;
}

export class AdmissionListDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['MERIT', 'WAITING'] }) kind: string;
  @ApiProperty() sequence: number;
  @ApiProperty({ enum: LIST_ORDERS, enumName: 'AdmissionListOrder' }) order_by: string;
  @ApiProperty() capacity: number;
  @ApiProperty({ type: String, nullable: true }) act_by_date: string | null;
  @ApiProperty({ type: String, nullable: true }) activated_at: string | null;
  @ApiProperty({ type: ListCountsDto }) counts: ListCountsDto;
  @ApiProperty({ type: [ListMemberDto], description: 'First 500 members.' })
  members: ListMemberDto[];
}

export class AdmissionListsResponseDto {
  @ApiProperty() seat_count: number;
  @ApiProperty({ description: 'seat_count - ADMITTED - OFFERED, never below 0.' })
  seats_left: number;
  @ApiProperty({ type: [AdmissionListDto] }) lists: AdmissionListDto[];
}

export class ListActionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Applicants moved to OFFERED / EXPIRED / WAITING by this call.' })
  affected: number;
}
