import { Module } from '@nestjs/common';
import { FeeModule } from '../../fees/fees.module';
import { SchoolsModule } from '../../schools/schools.module';
import { ExamDocumentsController } from './exam-documents.controller';
import { ExamDocumentsService } from './exam-documents.service';

/** [48.2.05] Exam "Print" tab feeds. 48.2.09 adds the portal controller here. */
@Module({
  imports: [FeeModule, SchoolsModule],
  controllers: [ExamDocumentsController],
  providers: [ExamDocumentsService],
})
export class ExamDocumentsModule {}
