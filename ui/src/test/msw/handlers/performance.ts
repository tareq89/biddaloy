import { http, HttpResponse } from 'msw';

const homework = { totalAssignments: 10, completed: 8, defaulters: 2, completionPercent: 80 };
const scope = {
  sectionId: null,
  academicYearId: 'year-1',
  termId: null,
  from: '2026-01-01',
  to: '2026-12-31',
};

/** [28.4.1] `/performance` happy-path fixtures, shaped like the generated response DTOs. */
export const performanceDefaultHandlers = [
  http.get('/api/v1/performance/students/:studentId', ({ params }) =>
    HttpResponse.json({
      studentId: String(params.studentId),
      classId: 'class-1',
      ...scope,
      passRate: 90,
      averageMarks: 72.5,
      averageGpa: 3.5,
      attendancePercent: 95,
      homework,
      noteRatingAverage: null,
      noteRatingCount: 0,
      exams: [],
    }),
  ),
  http.get('/api/v1/performance/classes/:classId', ({ params }) =>
    HttpResponse.json({
      classId: String(params.classId),
      ...scope,
      passRate: 88,
      averageMarks: 70,
      attendancePercent: 93,
      homework,
      exams: [],
    }),
  ),
  http.get('/api/v1/performance/staff/:userId', ({ params }) =>
    HttpResponse.json({
      userId: String(params.userId),
      acr: [],
      survey: { averageStars: null, surveyCount: 0 },
      incidentCount: 0,
      classes: [],
    }),
  ),
];
