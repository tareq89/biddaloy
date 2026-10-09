/**
 * [48.3.08] Pure mappers: API data -> the props of the code-rendered exam documents
 * (D12, D26, D35). No hooks, no JSX, so each is unit-tested without a router.
 */
import type {
  MarksSheetPage,
  ReportCardData,
  RoutineRow,
  RoomSitting,
  SeatRow,
  TabulationRow,
  TabulationSubject,
  TranscriptExam,
} from '@biddaloy/ui/components';
import type {
  AdmitCardRoster,
  ExamComponent,
  ExamScheduleRow,
  ResultDetail,
  SeatPlanDetail,
  StudentResultCard,
  Tabulation,
  Transcript,
} from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatTime, formatWeekday } from '@biddaloy/ui/utils';

import { subjectLabel } from '../../exams/-detail/subject-label';

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const timeRange = (s: ExamScheduleRow, cfg: RegionConfig) =>
  `${formatTime(s.starts_at, cfg)} – ${formatTime(s.ends_at, cfg)}`;

/** One page per room x sitting of THIS exam (D35). Other exams' sittings in a shared plan are dropped. */
export function seatPages(
  details: SeatPlanDetail[],
  schedules: ExamScheduleRow[],
  lang: string,
  cfg: RegionConfig,
): RoomSitting[] {
  const sched = new Map(schedules.map((s) => [s.id, s]));
  const pages = new Map<string, RoomSitting & { date: string; start: string; roomNo: string }>();
  for (const plan of details) {
    for (const room of plan.rooms) {
      for (const a of room.allocations) {
        const s = sched.get(a.exam_schedule_id);
        if (!s) continue;
        const key = `${room.room_id}|${s.id}`;
        let page = pages.get(key);
        if (!page) {
          const subject = s.subject ? subjectLabel(s.subject, lang) : '';
          page = {
            room: room.room_no ?? '—',
            roomNo: room.room_no ?? '',
            sitting: [
              `${formatWeekday(s.date, cfg)}, ${formatDate(s.date, cfg)}`,
              subject,
              timeRange(s, cfg),
            ]
              .filter(Boolean)
              .join(' · '),
            invigilator: room.invigilator_name,
            rows: [],
            date: s.date,
            start: s.starts_at,
          };
          pages.set(key, page);
        }
        page.rows.push({
          seat: a.seat_number,
          roll: a.roll_number,
          name: a.student_name,
          section: a.section_name,
        });
      }
    }
  }
  return [...pages.values()]
    .sort((a, b) => byText(a.date + a.start, b.date + b.start) || byText(a.roomNo, b.roomNo))
    .map((p) => ({
      room: p.room,
      sitting: p.sitting,
      ...(p.invigilator !== undefined ? { invigilator: p.invigilator } : {}),
      rows: p.rows.sort((a, b) => byText(a.seat, b.seat)),
    }));
}

/** A desk sticker: one per student per room, from their first sitting only. */
export function stickerRows(
  details: SeatPlanDetail[],
  schedules: ExamScheduleRow[],
): Array<SeatRow & { room: string }> {
  const sched = new Map(schedules.map((s) => [s.id, s]));
  const first = new Map<string, { key: string; row: SeatRow & { room: string } }>();
  for (const plan of details) {
    for (const room of plan.rooms) {
      for (const a of room.allocations) {
        const s = sched.get(a.exam_schedule_id);
        if (!s) continue;
        const key = s.date + s.starts_at;
        const id = `${room.room_id}|${a.student_id}`;
        const have = first.get(id);
        if (have && have.key <= key) continue;
        first.set(id, {
          key,
          row: {
            seat: a.seat_number,
            roll: a.roll_number,
            name: a.student_name,
            section: a.section_name,
            room: room.room_no ?? '—',
          },
        });
      }
    }
  }
  return [...first.values()]
    .map((v) => v.row)
    .sort((a, b) => byText(a.room, b.room) || byText(a.seat, b.seat));
}

/** Sections x subjects, each page lists the section's students by roll with the subject's components in order. */
export function marksPages(
  roster: AdmitCardRoster,
  components: ExamComponent[],
  subjectNames: Map<string, string>,
  className: string,
  sectionName?: string,
): MarksSheetPage[] {
  const sections = [...new Set(roster.students.map((s) => s.section_name ?? ''))]
    .filter((s) => sectionName === undefined || s === sectionName)
    .sort(byText);
  const bySubject = new Map<string, ExamComponent[]>();
  for (const c of [...components].sort((a, b) => a.sequence - b.sequence)) {
    bySubject.set(c.subject_id, [...(bySubject.get(c.subject_id) ?? []), c]);
  }
  const pages: MarksSheetPage[] = [];
  for (const section of sections) {
    const students = roster.students
      .filter((s) => (s.section_name ?? '') === section)
      .sort((a, b) => a.roll_number - b.roll_number)
      .map((s) => ({ roll: s.roll_number, name: s.full_name }));
    for (const [subjectId, comps] of bySubject) {
      pages.push({
        className,
        section,
        subject: subjectNames.get(subjectId) ?? '—',
        components: comps.map((c) => ({ name: c.name, fullMarks: Number(c.full_marks) })),
        students,
      });
    }
  }
  return pages;
}

export function routineRows(
  schedules: ExamScheduleRow[],
  lang: string,
  cfg: RegionConfig,
): RoutineRow[] {
  return [...schedules]
    .sort((a, b) => byText(a.date + a.starts_at, b.date + b.starts_at))
    .map((s) => ({
      date: formatDate(s.date, cfg),
      day: formatWeekday(s.date, cfg),
      subject: s.subject ? subjectLabel(s.subject, lang) : '—',
      time: timeRange(s, cfg),
    }));
}

export function tabulationProps(data: Tabulation, lang: string) {
  const subjects: TabulationSubject[] = data.subjects.map((s) => ({
    id: s.subject_id,
    name: lang.startsWith('bn') && s.name_bn ? s.name_bn : s.name_en,
    fullMarks: s.full_marks,
  }));
  const rows: TabulationRow[] = [...data.rows]
    .sort((a, b) => a.roll_number - b.roll_number)
    .map((r) => ({
      roll: r.roll_number,
      name: r.full_name,
      // A subject the student did not take stays absent from the record.
      cells: Object.fromEntries(
        Object.entries(r.cells).map(([id, c]) => [
          id,
          { obtained: c.obtained, grade: c.grade, isFail: c.is_fail },
        ]),
      ),
      total: r.total_marks,
      gpa: r.gpa,
      grade: r.grade,
      merit: r.section_position,
      isFail: r.is_fail,
    }));
  const failed = rows.filter((r) => r.isFail).length;
  return { subjects, rows, examinees: rows.length, failed, passed: rows.length - failed };
}

const examOf = (c: StudentResultCard): TranscriptExam => ({
  name: c.exam_name,
  subjects: c.subjects.map((s) => ({
    name: s.subject_name,
    obtained: s.obtained,
    grade: s.grade,
    gpa: s.gpa,
    isFail: s.is_fail,
  })),
  total: c.result.total_marks,
  isFail: c.result.is_fail,
  gpa: c.result.gpa,
  grade: c.result.grade,
  position: c.result.position,
});

export function transcriptProps(data: Transcript) {
  return {
    student: {
      name: data.student.full_name,
      roll: data.student.roll_number,
      className: data.student.class_name,
      section: data.student.section_name ?? '',
    },
    yearName: data.academic_year.name,
    exams: data.exams.map(examOf),
  };
}

export function reportCardProps(
  detail: ResultDetail,
  examName: string,
  bands: Array<{ grade: string; gpa: number | null; comment: string | null }>,
): ReportCardData {
  return {
    exam_name: examName,
    student: detail.student,
    result: detail.result,
    subjects: detail.subjects,
    legend: bands.map((b) => ({ grade: b.grade, gpa: b.gpa, comment: b.comment })),
  };
}
