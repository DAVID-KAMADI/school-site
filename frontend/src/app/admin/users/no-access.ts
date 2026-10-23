import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Shown when someone opens an admin page their role does not cover. */
@Component({
  selector: 'app-no-access',
  imports: [RouterLink],
  template: `
    <div class="a-panel box">
      <h1>You don't have access to this page</h1>
      <p class="a-muted">Your role does not include this part of the system. If you need it for your work, ask an administrator to change your role in Access control.</p>
      <a class="a-btn a-btn--primary" routerLink="/admin">Go to the dashboard</a>
    </div>
  `,
  styles: `
    .box { max-width: 36rem; margin: 3rem auto; text-align: center; }
    .box h1 { margin-top: 0; font-size: 1.4rem; }
  `,
})
export class NoAccess {}
