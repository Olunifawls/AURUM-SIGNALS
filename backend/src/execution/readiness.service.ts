import { Injectable } from '@nestjs/common';

/**
 * Startup-reconcile gate (roadmap D7/B6). NO order may be placed until the first
 * full reconciliation completes on boot. ReconciliationService marks ready;
 * ExecutionService refuses to place while not ready.
 */
@Injectable()
export class ExecutionReadinessService {
  private ready = false;

  markReady(): void {
    this.ready = true;
  }
  isReady(): boolean {
    return this.ready;
  }
}
