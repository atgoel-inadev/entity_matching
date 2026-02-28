import type { IAuditLogger } from '../../common/ports/audit-logger.port';
import type { ResolutionAuditEvent } from '../../common/models/audit.model';

/**
 * In-memory IAuditLogger for tests.
 * Records all logged events for assertion.
 * No Snowflake connection required — fully in-process.
 */
export class FakeAuditLogger implements IAuditLogger {
  readonly events: ResolutionAuditEvent[] = [];

  async logResolution(event: ResolutionAuditEvent): Promise<void> {
    this.events.push(event);
  }

  /** Clears all recorded events. */
  clear(): void {
    this.events.length = 0;
  }

  /** Returns the most recently logged event, or undefined. */
  lastEvent(): ResolutionAuditEvent | undefined {
    return this.events[this.events.length - 1];
  }
}
