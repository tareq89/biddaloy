import { ApiProperty } from '@nestjs/swagger';
import { TeacherAssignmentType } from '@biddaloy/shared';

/** One row of `GET /my-class/sections`: a section the caller is class
 * teacher or assistant of, this academic year. */
export class MyClassSectionDto {
  @ApiProperty() section_id: string;
  @ApiProperty() section_name: string;
  @ApiProperty() class_id: string;
  @ApiProperty() class_name: string;
  @ApiProperty({
    enum: [TeacherAssignmentType.CLASS_TEACHER, TeacherAssignmentType.ASSISTANT_CLASS_TEACHER],
    enumName: 'HomeroomAssignmentType',
  })
  assignment_type:
    TeacherAssignmentType.CLASS_TEACHER | TeacherAssignmentType.ASSISTANT_CLASS_TEACHER;
}
