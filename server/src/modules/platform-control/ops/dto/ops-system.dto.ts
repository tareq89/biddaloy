/** 'ok' | 'fail' only. Never an error text, host name or connection string. */
export type OpsProbeDto = 'ok' | 'fail';

export interface OpsRestoringSchoolDto {
  schoolId: string;
  schoolName: string;
  /** Status of the school's oldest unfinished restore job. */
  jobStatus: 'QUEUED' | 'RUNNING';
  /** Whether the restore lock key is currently held in Redis. */
  locked: boolean;
}

export interface OpsSystemResponseDto {
  appVersion: string;
  /** Name of the last applied migration, or null when it cannot be read. */
  lastMigration: string | null;
  database: OpsProbeDto;
  redis: OpsProbeDto;
  restoring: OpsRestoringSchoolDto[];
}

export interface OpsReleaseLockResponseDto {
  /** True when a lock key was removed or a stuck job was failed. */
  released: boolean;
  /** Restore jobs that were QUEUED or RUNNING and are now FAILED. */
  failedJobs: number;
}
