import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TrackingService } from './tracking.service';
import { TRACKING_QUEUE_NAME, TrackingJobName, type BroadcastTripUpdateJobData } from './constants/tracking-queue.constant';

/**
 * Runs the HEAVY part of a location update off the request thread: the
 * multi-table join to rebuild the trip, ETA calculation, and the socket
 * fan-out. TrackingController's location endpoint stays low-latency
 * because it only ever enqueues a job here — it never does this work
 * itself.
 */
@Processor(TRACKING_QUEUE_NAME, { concurrency: 10 })
export class TrackingBroadcastProcessor extends WorkerHost {
  constructor(private readonly trackingService: TrackingService) {
    super();
  }

  async process(job: Job<BroadcastTripUpdateJobData>): Promise<void> {
    if (job.name !== TrackingJobName.BROADCAST_TRIP_UPDATE) return;
    await this.trackingService.broadcastTripUpdate(job.data.tripId);
  }
}