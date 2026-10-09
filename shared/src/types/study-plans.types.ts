export interface StudyPlanLesson {
  id: string;
  title: string;
  periods: number;
  topic_id?: string;
  notes?: string;
}

export interface StudyPlanExamMarker {
  exam_id: string;
  up_to_lesson_id: string;
}

/** A template lesson never carries a topic link: topics are per class and year (D4). */
export type StudyPlanTemplateLesson = Omit<StudyPlanLesson, 'topic_id'>;
