/** One queue's counts. Counts only: job data and names hold school data and never leave. */
export interface OpsQueueDto {
  name: string;
  available: boolean;
  waiting?: number;
  active?: number;
  failed?: number;
  delayed?: number;
}

export interface OpsQueuesResponseDto {
  queues: OpsQueueDto[];
}

export interface OpsRetryResponseDto {
  retried: number;
}
