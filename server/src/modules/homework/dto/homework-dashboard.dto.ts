import { ApiProperty } from '@nestjs/swagger';

export class SyllabusClassProgressDto {
  @ApiProperty({ format: 'uuid' }) class_id!: string;
  @ApiProperty({ example: '8' }) class_name!: string;
  @ApiProperty({ description: 'Topics with status DONE' }) done!: number;
  @ApiProperty({ description: 'Topics with status IN_PROGRESS' }) in_progress!: number;
  @ApiProperty({ description: 'All topics of the class' }) total!: number;
  @ApiProperty({ description: 'round(done / total * 100)', example: 41 }) percentage!: number;
}

export class SyllabusOverallProgressDto {
  @ApiProperty() done!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ example: 60 }) percentage!: number;
}

export class SyllabusProgressWidgetDto {
  @ApiProperty({ type: [SyllabusClassProgressDto] }) classes!: SyllabusClassProgressDto[];
  @ApiProperty({ type: SyllabusOverallProgressDto }) overall!: SyllabusOverallProgressDto;
}
