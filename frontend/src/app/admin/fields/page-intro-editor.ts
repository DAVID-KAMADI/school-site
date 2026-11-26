import { Component, effect, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api-url.interceptor';
import type { PageIntroEdit } from '../api';
import { toastChannel } from '../toast';

/** The heading area of the Gallery or Our people page: small label, title and introduction. Folds away when not needed. */
@Component({
  selector: 'app-page-intro-editor',
  imports: [FormsModule],
  template: `
    <details class="a-panel intro" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary>
        <strong>Page heading</strong>
        <span class="a-muted a-small"
          >“{{ draft().title }}” — the label, title and introduction at the top of
          <a [href]="viewUrl()" target="_blank" rel="noopener">{{ viewUrl() }}</a></span
        >
      </summary>
      <form class="a-stack form" (ngSubmit)="save()">
        <div class="a-row">
          <label class="a-field"
            ><span>Small label above the title <small class="a-muted">(optional)</small></span>
            <input class="a-input" name="eyebrow" maxlength="60" [(ngModel)]="draft().eyebrow" />
          </label>
          <label class="a-field"
            ><span>Title</span>
            <input
              class="a-input"
              name="title"
              maxlength="80"
              required
              [(ngModel)]="draft().title"
            />
          </label>
        </div>
        <label class="a-field"
          ><span>Introduction <small class="a-muted">(optional)</small></span>
          <textarea
            class="a-textarea"
            name="intro"
            maxlength="400"
            rows="2"
            [(ngModel)]="draft().intro"
          ></textarea>
        </label>
        <div class="a-toolbar">
          <button class="a-btn a-btn--primary" type="submit" [disabled]="saving()">
            Save heading
          </button>
        </div>
      </form>
    </details>
  `,
  styles: `
    .intro {
      margin-bottom: 1rem;
    }
    summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      align-items: baseline;
      cursor: pointer;
    }
    .form {
      margin-top: 1rem;
    }
  `,
})
export class PageIntroEditor {
  readonly value = input.required<PageIntroEdit>();
  readonly saver = input.required<(v: PageIntroEdit) => Promise<unknown>>();
  readonly viewUrl = input.required<string>();

  protected readonly draft = signal<PageIntroEdit>({ eyebrow: '', title: '', intro: '' });
  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly message = toastChannel();

  constructor() {
    effect(() => this.draft.set({ ...this.value() }));
  }

  async save() {
    this.saving.set(true);
    try {
      await this.saver()(this.draft());
      this.message.set({ kind: 'success', text: 'Page heading saved.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.saving.set(false);
    }
  }
}
