export type OnboardingItemId =
  | 'profile'
  | 'structure'
  | 'sections'
  | 'students'
  | 'staff'
  | 'feeStructures'
  | 'guardianInvites'
  | 'messageSettings';

export type OnboardingSetupPath = 'guided' | 'excel' | 'later';

export interface OnboardingStatus {
  finished_at: string | null;
  dismissed_at: string | null;
  seen: boolean;
  setup_path: OnboardingSetupPath | null;
  items: { id: OnboardingItemId; done: boolean }[];
  counts: { classes: number; sections: number; students: number; staff: number };
  trial: { ends_at: string; days_left: number; seats: { used: number; limit: number } } | null;
  support_url: string | null;
}

export const TRIAL_EXPIRED_REASON = 'TRIAL_EXPIRED';
