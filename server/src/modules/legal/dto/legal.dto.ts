import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsObject,
} from 'class-validator';
import { LegalDocument } from '@biddaloy/shared';

/** Body of `POST /legal/accept`. */
export class AcceptLegalDto {
  @ApiProperty({ enum: LegalDocument, isArray: true, maxItems: 4 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsEnum(LegalDocument, { each: true })
  documents: LegalDocument[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Version of each named document, as displayed to the user.',
  })
  @IsObject()
  versions: Partial<Record<LegalDocument, string>>;
}

/** What the caller still owes in this school. */
export class LegalStatusResponseDto {
  @ApiProperty({ enum: LegalDocument, isArray: true })
  pending: LegalDocument[];
}
