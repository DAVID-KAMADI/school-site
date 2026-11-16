import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, signal, TransferState } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** GET /api/v1/maintenance: maintenance mode, or a backup restore, as seen by this visitor. */
export interface MaintenanceStatus {
  /** Visitors should see the maintenance page. */
  active: boolean;
  /** This visitor is signed-in staff and sees the site anyway. */
  bypass: boolean;
  restoring: boolean;
  title: string;
  message: string;
  endsAt: string | null;
  startedAt: string | null;
}

const KEY = makeStateKey<MaintenanceStatus | null>('maintenance');

/**
 * Whether the maintenance page replaces the site. On the server the website server has already worked
 * it out for this visitor (see server.ts) and passes it in; the browser starts from the same answer
 * (so the page does not flash) and asks the API again when it needs to.
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceStore {
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly status = signal<MaintenanceStatus | null>(null);

  constructor() {
    const state = inject(TransferState);
    if (this.browser) {
      this.status.set(state.get(KEY, null));
      state.remove(KEY);
      if (!this.status()) void this.refresh();
    } else {
      const context = inject(REQUEST_CONTEXT, { optional: true }) as { maintenance?: MaintenanceStatus } | null;
      this.status.set(context?.maintenance ?? null);
      state.set(KEY, this.status());
    }
  }

  async refresh(): Promise<MaintenanceStatus | null> {
    try {
      this.status.set(await firstValueFrom(this.http.get<MaintenanceStatus>('/api/v1/maintenance')));
    } catch {
      /* API unreachable: keep what we had */
    }
    return this.status();
  }
}
