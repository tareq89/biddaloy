import type { DemoSlice } from '../context';
import { AttendanceSession } from '../../../modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../../modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../../../modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../../../modules/attendance/entities/attendance-device-event.entity';
import { StaffAttendanceSession } from '../../../modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../../../modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeavePolicy } from '../../../modules/leave/entities/leave-policy.entity';
import { LeaveRecord } from '../../../modules/leave/entities/leave-record.entity';

export const slice: DemoSlice = {
  name: 'attendance',
  covers: [
    AttendanceSession,
    AttendanceRecord,
    AttendanceDevice,
    AttendanceDeviceEvent,
    StaffAttendanceSession,
    StaffAttendanceRecord,
    LeavePolicy,
    LeaveRecord,
  ],
  owedBy: '58.3.01',
  run: async () => {},
};
