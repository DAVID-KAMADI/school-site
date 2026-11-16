import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { API_UNREACHABLE_MESSAGE } from '../core/api-url.interceptor';
import { Icon, type IconName } from './icon';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  kind: string;
  text: string;
  list?: string[];
}

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  list?: string[];
  leaving: boolean;
}

const KINDS: ToastKind[] = ['success', 'error', 'warning', 'info'];
const ICONS: Record<ToastKind, IconName> = { success: 'check', error: 'alert', warning: 'alert', info: 'activity' };
const TITLES: Record<ToastKind, string> = { success: 'Done', error: 'Something went wrong', warning: 'Check this', info: 'Note' };
/** How long the slide-out animation takes (keep in step with the CSS below). */
const LEAVE_MS = 250;

/**
 * Small notifications that slide in from the right and go away on their own.
 * Success notes are brief (about a second for short messages); errors and warnings stay longer and can be closed.
 * Hovering a notification keeps it open.
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(text: string) {
    this.show({ kind: 'success', text });
  }

  error(text: string, list?: string[]) {
    this.show({ kind: 'error', text, list });
  }

  show(input: ToastInput) {
    const kind = (KINDS as string[]).includes(input.kind) ? (input.kind as ToastKind) : 'info';
    const toast: Toast = { id: this.nextId++, kind, text: input.text, list: input.list?.length ? input.list : undefined, leaving: false };
    // The same message twice in a row (e.g. Save clicked repeatedly) replaces the old one instead of stacking.
    for (const t of this.items()) if (t.text === toast.text && t.kind === toast.kind) this.remove(t.id);
    this.items.update((list) => [...list.slice(-3), toast]);
    this.schedule(toast);
  }

  /** Pause while the pointer is over a notification. */
  hold(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  release(id: number) {
    const t = this.items().find((x) => x.id === id);
    if (t && !t.leaving) this.timers.set(id, setTimeout(() => this.dismiss(id), 1200));
  }

  dismiss(id: number) {
    this.hold(id);
    this.items.update((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => this.remove(id), LEAVE_MS);
  }

  private remove(id: number) {
    this.hold(id);
    this.items.update((list) => list.filter((t) => t.id !== id));
  }

  private schedule(t: Toast) {
    const words = t.text.split(/\s+/).length + (t.list?.join(' ').split(/\s+/).length ?? 0);
    // Short success notes: about a second. Longer text gets time to be read.
    const ms =
      t.kind === 'success' || t.kind === 'info'
        ? Math.min(5000, Math.max(1200, words * 220))
        : Math.min(10000, Math.max(4000, words * 300));
    this.timers.set(t.id, setTimeout(() => this.dismiss(t.id), ms));
  }
}

/**
 * Drop-in replacement for a component's `message` signal: `this.message.set({ kind, text })` shows a toast.
 * Setting null does nothing (there is no banner to clear any more).
 */
export function toastChannel() {
  const toasts = inject(Toasts);
  return {
    set(m: ToastInput | null) {
      if (m) toasts.show(m);
    },
  };
}

@Component({
  selector: 'app-toaster',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div
          class="toast toast--{{ t.kind }}"
          [class.toast--leaving]="t.leaving"
          [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          (mouseenter)="toasts.hold(t.id)"
          (mouseleave)="toasts.release(t.id)"
        >
          <span class="toast__icon"><app-icon [name]="icon(t.kind)" [size]="16" /></span>
          <div class="toast__body">
            <strong>{{ title(t) }}</strong>
            <span>{{ t.text }}</span>
            @if (t.list) {
              <ul>
                @for (item of t.list; track $index) {
                  <li>{{ item }}</li>
                }
              </ul>
            }
          </div>
          <button type="button" class="toast__close" (click)="toasts.dismiss(t.id)" aria-label="Close notification">
            <app-icon name="close" [size]="14" />
          </button>
          <span class="toast__bar"></span>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; top: 4.6rem; right: 1rem; z-index: 1000; display: grid; gap: 0.6rem; width: min(24rem, calc(100vw - 2rem)); pointer-events: none; }
    .toast {
      --c: var(--a-primary); --soft: var(--a-primary-soft);
      position: relative; overflow: hidden; pointer-events: auto;
      display: flex; align-items: flex-start; gap: 0.7rem;
      padding: 0.8rem 0.7rem 0.85rem 0.85rem;
      background: #fff; border: 1px solid var(--a-line); border-left: 4px solid var(--c); border-radius: 10px;
      box-shadow: var(--a-shadow-lg);
      animation: toast-in 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    }
    .toast--success { --c: var(--a-success); --soft: var(--a-success-soft); }
    .toast--error { --c: var(--a-danger); --soft: var(--a-danger-soft); }
    .toast--warning { --c: var(--a-warning); --soft: var(--a-warning-soft); }
    .toast--leaving { animation: toast-out 0.25s ease-in both; }
    .toast__icon { flex: none; display: grid; place-items: center; width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--soft); color: var(--c); }
    .toast__body { flex: 1; min-width: 0; display: grid; gap: 0.1rem; font-size: 0.88rem; line-height: 1.4; overflow-wrap: anywhere; }
    .toast__body strong { font-size: 0.92rem; color: var(--a-text); }
    .toast__body span { color: var(--a-muted); }
    .toast__body ul { margin: 0.3rem 0 0; padding-left: 1.1rem; color: var(--a-text); font-size: 0.82rem; }
    .toast__close { flex: none; display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border: 0; border-radius: 6px; background: none; color: var(--a-muted); cursor: pointer; }
    .toast__close:hover, .toast__close:focus-visible { background: var(--a-bg); color: var(--a-text); }
    .toast__bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--c); opacity: 0.25; }
    @keyframes toast-in { from { opacity: 0; transform: translateX(110%); } }
    @keyframes toast-out { to { opacity: 0; transform: translateX(110%); } }
    @media (prefers-reduced-motion: reduce) { .toast, .toast--leaving { animation-duration: 0.01s; } }
  `,
})
export class Toaster {
  protected readonly toasts = inject(Toasts);
  protected icon(kind: ToastKind) {
    return ICONS[kind];
  }
  protected title(t: Toast) {
    return t.kind === 'error' && t.text === API_UNREACHABLE_MESSAGE ? 'Cannot reach the server' : TITLES[t.kind];
  }
}
