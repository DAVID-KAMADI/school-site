import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api-url.interceptor';
import { AuthStore } from '../core/auth';

/** The signed-in user's own password and sessions. */
@Component({
  selector: 'app-account',
  imports: [FormsModule],
  template: `
    <h1>My account</h1>
    <section class="a-panel">
      <p><strong>{{ auth.user()?.fullName }}</strong><br /><span class="a-muted">{{ auth.user()?.email }}</span></p>
      <p class="a-small">Roles: {{ auth.user()?.roles?.join(', ') }}</p>
    </section>
    <section class="a-panel">
      <h2>Change password</h2>
      @if (message(); as m) {
        <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
      }
      <form class="a-stack narrow" (ngSubmit)="change()">
        <label class="a-field"><span>Current password</span><input class="a-input" type="password" name="cur" autocomplete="current-password" required [(ngModel)]="current" /></label>
        <label class="a-field">
          <span>New password</span>
          <input class="a-input" type="password" name="new" autocomplete="new-password" minlength="12" required [(ngModel)]="next" />
          <span class="a-help">At least 12 characters. A short sentence is easy to remember and hard to guess.</span>
        </label>
        <div><button class="a-btn a-btn--primary" type="submit">Change password</button></div>
      </form>
    </section>
    <section class="a-panel">
      <h2>Signed-in devices</h2>
      <p class="a-muted">Used a shared or cyber-café computer? Sign out everywhere.</p>
      <button class="a-btn a-btn--danger" type="button" (click)="logoutAll()">Sign out of all devices</button>
    </section>
  `,
  styles: `.narrow { max-width: 24rem; }`,
})
export class Account {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  protected current = '';
  protected next = '';
  protected readonly message = signal<{ kind: string; text: string } | null>(null);

  constructor() {
    inject(Title).setTitle('My account | Admin');
  }

  async change() {
    try {
      await this.auth.changePassword(this.current, this.next);
      this.current = this.next = '';
      this.message.set({ kind: 'success', text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async logoutAll() {
    await this.auth.logout(true);
    await this.router.navigateByUrl('/admin/login');
  }
}
