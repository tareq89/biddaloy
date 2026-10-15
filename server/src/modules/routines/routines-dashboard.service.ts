import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { Room } from './entities/room.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { localToday } from '../../common/time';
import { addDays } from '../attendance/attendance-dashboard.service';
import type {
  MyRoutineNextDayDto,
  MyRoutinePeriodDto,
  MyRoutineTodayDto,
} from './dto/routines-dashboard.dto';

const hhmm = (t: string) => t.slice(0, 5);

/**
 * "My routine today" teacher widget. The slots come from
 * `ResolveRoutineService` (D14: the only reader of `routine_slots`); this
 * class only adds names, one `In(...)` lookup per table.
 */
@Injectable()
export class RoutinesDashboardService {
  constructor(
    private readonly resolver: ResolveRoutineService,
    private readonly calendar: SchoolCalendarService,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(Room) private readonly roomRepo: Repository<Room>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(TeacherClassSection)
    private readonly assignmentRepo: Repository<TeacherClassSection>,
  ) {}

  async myRoutineToday(
    tenantId: string,
    caller: { userId: string; role: string },
  ): Promise<MyRoutineTodayDto> {
    const today = localToday();
    const workingDays = await this.calendar.getWorkingDays({
      tenantId,
      from: today,
      to: today,
    });
    const base = { date: today, is_working_day: workingDays.dates.includes(today) };

    const teacher = await this.teacherRepo.findOne({
      where: { user_id: caller.userId, tenant_id: tenantId },
    });
    if (!teacher) return { ...base, periods: [], next_day: null };

    const slots = await this.resolver.resolveRoutine(
      { teacher_id: teacher.id, from: today, to: addDays(today, 7) },
      tenantId,
      caller,
    );
    if (!slots.length) return { ...base, periods: [], next_day: null };

    const sectionIds = [...new Set(slots.map((s) => s.section_id))];
    const roomIds = [...new Set(slots.flatMap((s) => (s.room_id ? [s.room_id] : [])))];
    const [sections, rooms, homeroom] = await Promise.all([
      this.sectionRepo.find({ where: { id: In(sectionIds), tenant_id: tenantId } }),
      roomIds.length
        ? this.roomRepo.find({ where: { id: In(roomIds), tenant_id: tenantId }, withDeleted: true })
        : Promise.resolve([] as Room[]),
      this.assignmentRepo.find({
        where: {
          tenant_id: tenantId,
          teacher_id: teacher.id,
          section_id: In(sectionIds),
          assignment_type: In([
            TeacherAssignmentType.CLASS_TEACHER,
            TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
          ]),
        },
      }),
    ]);
    const classes = await this.classRepo.find({
      where: { id: In([...new Set(sections.map((s) => s.class_id))]), tenant_id: tenantId },
      withDeleted: true,
    });
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const className = new Map(classes.map((c) => [c.id, c.name]));
    const roomLabel = new Map(
      rooms.map((r) => [r.id, r.building ? `${r.building} ${r.room_no}` : r.room_no]),
    );
    const homeroomIds = new Set(homeroom.map((a) => a.section_id));
    const names = (sectionId: string) => {
      const s = sectionById.get(sectionId);
      return {
        class_name: (s && className.get(s.class_id)) ?? '',
        section_name: s?.section_name ?? '',
      };
    };

    const periods: MyRoutinePeriodDto[] = slots
      .filter((s) => s.date === today)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((s) => ({
        starts_at: hhmm(s.starts_at),
        ends_at: hhmm(s.ends_at),
        section_id: s.section_id,
        ...names(s.section_id),
        subject_name_en: s.subject_name_en,
        subject_name_bn: s.subject_name_bn,
        room_label: (s.room_id && roomLabel.get(s.room_id)) || null,
        is_homeroom: homeroomIds.has(s.section_id),
        covering: !!s.covering_for_teacher_ids?.length,
        cancelled: s.cancelled,
      }));

    const next = slots
      .filter((s) => s.date > today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.starts_at.localeCompare(b.starts_at))[0];
    const next_day: MyRoutineNextDayDto | null = next
      ? {
          date: next.date,
          starts_at: hhmm(next.starts_at),
          ...names(next.section_id),
          subject_name_en: next.subject_name_en,
          subject_name_bn: next.subject_name_bn,
        }
      : null;

    return { ...base, periods, next_day };
  }
}
