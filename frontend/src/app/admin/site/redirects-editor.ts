import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi } from '../api';

type RedirectRow = { id: number; fromPath: string; toPath: string; statusCode: number; hitCount: number };

/** Old addresses that forward to new ones. Page moves add these automatically; add your own for the old website. */
@Component({
  selector: 'app-redirects-editor',
  imports: [FormsModule],
  template: `
    <h1>Redirects</h1>
    <p class="a-muted">Moving or deleting a live page creates a redirect automatically. Add redirects here for addresses from the old website.</p>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    <form class="a-panel a-row" (ngSubmit)="add()">
      <label class="a-field"><span>Old address</span><input class="a-input" name="from" [(ngModel)]="from" placeholder="/old-page.html" required /></label>
      <label class="a-field"><span>Send visitors to</span><input class="a-input" name="to" [(ngModel)]="to" placeholder="/new-page" required /></label>
      <label class="a-field type"><span>Type</span>
        <select class="a-select" name="code" [(ngModel)]="code"><option [ngValue]="301">Permanent (301)</option><option [ngValue]="302">Temporary (302)</option></select>
      </label>
      <button class="a-btn a-btn--primary add" type="submit">Add redirect</button>
    </form>
    <div class="a-table-wrap list">
      <table class="a-table">
        <thead><tr><th>Old address</th><th>Goes to</th><th>Type</th><th>Used</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td><code>{{ r.fromPath }}</code></td>
              <td><code>{{ r.toPath }}</code></td>
              <td>{{ r.statusCode }}</td>
              <td>{{ r.hitCount }}</td>
              <td><button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="remove(r)">Delete</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="a-empty">No redirects.</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `.type { flex: 0 0 12rem; } .add { flex: 0 0 auto; } .list { margin-top: 1rem; }`,
})
export class RedirectsEditor {
  private readonly api = inject(AdminApi);
  protected readonly rows = signal<RedirectRow[]>([]);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected from = '';
  protected to = '';
  protected code = 301;

  constructor() {
    inject(Title).setTitle('Redirects | Admin');
    void this.load();
  }

  private async load() {
    try {
      this.rows.set(await this.api.redirects());
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async add() {
    try {
      await this.api.saveRedirect({ fromPath: this.from.trim(), toPath: this.to.trim(), statusCode: this.code });
      this.from = this.to = '';
      this.message.set({ kind: 'success', text: 'Redirect saved.' });
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async remove(r: RedirectRow) {
    if (!confirm(`Delete the redirect from ${r.fromPath}?`)) return;
    await this.api.deleteRedirect(r.id).catch((err) => this.message.set({ kind: 'error', text: errorMessage(err) }));
    await this.load();
  }
}
