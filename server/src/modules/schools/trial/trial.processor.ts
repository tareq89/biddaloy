import { Processor, WorkerHost } from '@nestjs/bullmq';
import { TRIAL_QUEUE } from './trial.constants';
import { TrialService } from './trial.service';

@Processor(TRIAL_QUEUE)
export class TrialProcessor extends WorkerHost {
  constructor(private readonly trial: TrialService) {
    super();
  }

  async process(): Promise<void> {
    await this.trial.runDaily(new Date());
  }
}
