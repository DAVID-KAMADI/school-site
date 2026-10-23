import { Component, ViewEncapsulation, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';

/** Wraps every /admin screen so the admin styles load only for staff. */
@Component({
  selector: 'app-admin-root',
  imports: [RouterOutlet],
  template: '<div class="admin"><router-outlet /></div>',
  styleUrl: './admin.scss',
  encapsulation: ViewEncapsulation.None,
})
export class AdminRoot {
  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }
}
