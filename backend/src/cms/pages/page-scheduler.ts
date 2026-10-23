import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PagesService } from './pages.service.js';

/** Publishes and unpublishes pages at their scheduled times, and empties the trash after 30 days. */
@Injectable()
export class PageScheduler {
  private readonly logger = new Logger(PageScheduler.name);

  constructor(private readonly pages: PagesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async publishDue(): Promise<void> {
    try {
      const { published, unpublished } = await this.pages.runSchedule();
      if (published || unpublished)
        this.logger.log(
          `Scheduled: ${published} published, ${unpublished} unpublished`,
        );
    } catch (err) {
      this.logger.error('Scheduled publishing failed', err as Error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeTrash(): Promise<void> {
    try {
      const purged = await this.pages.purgeTrash();
      if (purged) this.logger.log(`Purged ${purged} page(s) from trash`);
    } catch (err) {
      this.logger.error('Trash purge failed', err as Error);
    }
  }
}
