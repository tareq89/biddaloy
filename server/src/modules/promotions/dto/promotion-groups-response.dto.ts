import { ApiProperty } from '@nestjs/swagger';

/** One subject of a student's shown result (`GroupResultSubject`). */
export class PromotionGroupSubjectDto {
  @ApiProperty() subject_code: string;
  @ApiProperty() marks: number;
  @ApiProperty() grade: string;
}

/** Where the shown result came from: a published final result, the latest exam, or none. */
export class PromotionGroupResultDto {
  @ApiProperty({ type: Number, nullable: true }) gpa: number | null;
  @ApiProperty({ type: [PromotionGroupSubjectDto] }) subjects: PromotionGroupSubjectDto[];
  @ApiProperty({ enum: ['FINAL_RESULT', 'EXAM'], nullable: true })
  source: 'FINAL_RESULT' | 'EXAM' | null;
}

/** One row of `GET /promotions/:id/groups` (`PromotionGroupEntryView`). */
export class PromotionGroupEntryDto {
  @ApiProperty() entry_id: string;
  @ApiProperty() student_id: string;
  @ApiProperty({ type: String, nullable: true }) student_name: string | null;
  @ApiProperty({ type: String, nullable: true }) source_section_id: string | null;
  @ApiProperty({ type: String, nullable: true }) source_section_name: string | null;
  @ApiProperty({ type: String, nullable: true }) group_name: string | null;
  @ApiProperty({ type: PromotionGroupResultDto }) result: PromotionGroupResultDto;
}

/** A source section of the run, for the section filter's options. */
export class PromotionGroupSectionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class PromotionGroupEntriesPageDto {
  @ApiProperty({ type: [PromotionGroupEntryDto] }) data: PromotionGroupEntryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  /** Every source section of the run the caller can reach, ignoring the other filters. */
  @ApiProperty({ type: [PromotionGroupSectionDto] }) sections: PromotionGroupSectionDto[];
}
