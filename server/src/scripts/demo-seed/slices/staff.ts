import type { DemoSlice } from '../context';
import { Teacher } from '../../../modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../../../modules/academics/entities/teacher-class-section.entity';
import { StaffProfile } from '../../../modules/staff-profiles/entities/staff-profile.entity';
import { StaffHrRecord } from '../../../modules/staff-hr/entities/staff-hr-record.entity';
import { Designation } from '../../../modules/staff-hr/entities/designation.entity';
import { StaffDesignationHistory } from '../../../modules/staff-hr/entities/staff-designation-history.entity';
import { StaffFamilyMember } from '../../../modules/staff-hr/entities/staff-family-member.entity';
import { StaffAddress } from '../../../modules/staff-hr/entities/staff-address.entity';
import { StaffExperience } from '../../../modules/staff-hr/entities/staff-experience.entity';
import { StaffEducation } from '../../../modules/staff-hr/entities/staff-education.entity';
import { StaffTraining } from '../../../modules/staff-hr/entities/staff-training.entity';
import { StaffAchievement } from '../../../modules/staff-hr/entities/staff-achievement.entity';
import { StaffLanguage } from '../../../modules/staff-hr/entities/staff-language.entity';
import { StaffDocument } from '../../../modules/staff-hr/entities/staff-document.entity';

export const slice: DemoSlice = {
  name: 'staff',
  covers: [
    Teacher,
    TeacherClassSection,
    StaffProfile,
    StaffHrRecord,
    Designation,
    StaffDesignationHistory,
    StaffFamilyMember,
    StaffAddress,
    StaffExperience,
    StaffEducation,
    StaffTraining,
    StaffAchievement,
    StaffLanguage,
    StaffDocument,
  ],
  owedBy: '58.2.02',
  run: async () => {},
};
