import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import { AdminApi, type AccessMatrix, type AccessReviewRow } from '../api';

type Tab = 'roles' | 'review';
type Role = AccessMatrix['roles'][number];

/** Signing in to the admin portal: granted automatically with any other permission, so not shown. */
const ADMIN_ACCESS = 'admin.access';

/**
 * Admin → Access control: what each staff role may see and do, and who holds which role.
 * The API checks every permission on every request, so changes apply straight away.
 */
@Component({
  selector: 'app-access-control',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="head">
      <h1>Access control</h1>
      <p class="a-muted">Decide what each staff role can see and do. Changes apply straight away, without anyone signing in again.</p>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="chip" [class.chip--on]="tab() === 'roles'" [attr.aria-selected]="tab() === 'roles'" (click)="tab.set('roles')">Roles &amp; permissions</button>
      <button type="button" role="tab" class="chip" [class.chip--on]="tab() === 'review'" [attr.aria-selected]="tab() === 'review'" (click)="showReview()">Who has access</button>
    </div>

    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }

    @if (tab() === 'roles') {
      @if (matrix(); as mx) {
        <div class="layout">
          <aside class="roles a-panel" aria-label="Roles">
            <ul>
              @for (r of mx.roles; track r.key) {
                <li>
                  <button type="button" class="role" [class.role--on]="r.key === selectedKey()" (click)="select(r.key)">
                    <span class="role__name">{{ r.name }} @if (r.locked) {<span class="lock" title="Fixed role">🔒</span>}</span>
                    <span class="role__meta">{{ r.people }} {{ r.people === 1 ? 'person' : 'people' }} · {{ r.locked ? 'everything' : countLabel(r) }}</span>
                  </button>
                </li>
              }
            </ul>
            @if (canManage()) {
              <button class="a-btn a-btn--primary new" type="button" (click)="openCreate()">+ New role</button>
            }
          </aside>

          @if (selected(); as r) {
            <section class="editor" [attr.aria-label]="'Permissions for ' + r.name">
              <div class="a-panel editor__head">
                @if (renaming()) {
                  <form class="a-stack" (ngSubmit)="saveDetails(r)">
                    <label class="a-field"><span>Role name</span><input class="a-input" name="name" maxlength="100" required [(ngModel)]="editName" /></label>
                    <label class="a-field"><span>Description</span><input class="a-input" name="desc" maxlength="255" [(ngModel)]="editDescription" /></label>
                    <div class="a-toolbar">
                      <button class="a-btn a-btn--primary a-btn--sm" type="submit">Save</button>
                      <button class="a-btn a-btn--sm" type="button" (click)="renaming.set(false)">Cancel</button>
                    </div>
                  </form>
                } @else {
                  <div class="a-toolbar a-toolbar--spread">
                    <div>
                      <h2>{{ r.name }}</h2>
                      @if (r.description) {<p class="a-muted">{{ r.description }}</p>}
                    </div>
                    @if (canManage() && !r.locked) {
                      <div class="a-toolbar">
                        <button class="a-btn a-btn--sm" type="button" (click)="startRename(r)">Rename</button>
                        <button class="a-btn a-btn--sm a-btn--danger" type="button" [disabled]="r.people > 0" [title]="r.people ? 'Give its ' + r.people + ' holder(s) another role first' : ''" (click)="remove(r)">Delete role</button>
                      </div>
                    }
                  </div>
                }
                @if (r.locked) {
                  <p class="a-alert a-alert--info">The {{ r.name }} has every permission, including new ones, and cannot be changed. Give it only to the people who look after the whole system.</p>
                } @else if (!canManage()) {
                  <p class="a-alert a-alert--info">View only. You need the “Edit roles and what each role may do” permission to change roles.</p>
                } @else {
                  <p class="a-small a-muted">Tick what people with this role may do. Anyone with at least one permission can sign in to the admin portal and only sees the parts they are allowed.</p>
                }
              </div>

              <div class="modules">
                @for (g of groups(); track g.module; let i = $index) {
                  @if (i === 0 || groups()[i - 1].section !== g.section) {
                    <h3 class="section">{{ g.section }}</h3>
                  }
                  <fieldset class="module a-panel">
                    <legend class="sr-only">{{ g.module }}</legend>
                    <div class="module__head">
                      <h4>{{ g.title }}</h4>
                      @if (editable()) {
                        <label class="a-check all"><input type="checkbox" [checked]="allOn(g.keys)" [indeterminate]="someOn(g.keys)" (change)="setAll(g.keys, $any($event.target).checked)" /> All</label>
                      }
                    </div>
                    @for (p of g.items; track p.key) {
                      <label class="perm" [class.perm--on]="draft().has(p.key)">
                        <input type="checkbox" [checked]="draft().has(p.key)" [disabled]="!editable()" (change)="toggle(p.key, $any($event.target).checked)" />
                        <span>{{ p.description }}<code>{{ p.key }}</code></span>
                      </label>
                    }
                  </fieldset>
                }
              </div>

              @if (dirty()) {
                <div class="savebar a-panel" role="region" aria-label="Unsaved changes">
                  <span><strong>Unsaved changes</strong> to {{ r.name }}: {{ changeSummary() }}</span>
                  <div class="a-toolbar">
                    <button class="a-btn" type="button" (click)="undo()">Undo</button>
                    <button class="a-btn a-btn--primary" type="button" [disabled]="saving()" (click)="save(r)">{{ saving() ? 'Saving…' : 'Save permissions' }}</button>
                  </div>
                </div>
              }
            </section>
          }
        </div>
      } @else if (!message()) {
        <p class="a-muted">Loading…</p>
      }
    }

    @if (tab() === 'review') {
      <div class="a-toolbar a-toolbar--spread filters">
        <input class="a-input" type="search" placeholder="Search staff by name, email or role" [(ngModel)]="search" aria-label="Search staff" />
        <a class="a-small" routerLink="/admin/users">Change someone's roles in Staff users</a>
      </div>
      <div class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>Staff member</th><th>Roles</th><th>Can reach</th><th>Last sign-in</th></tr></thead>
          <tbody>
            @for (u of filteredReview(); track u.id) {
              <tr [class.off]="u.status !== 'active'">
                <td><strong>{{ u.fullName }}</strong><div class="a-small a-muted">{{ u.email }}</div>@if (u.status !== 'active') {<span class="a-badge">{{ u.status }}</span>}</td>
                <td>@for (role of u.roles; track $index) {<span class="a-badge">{{ role.name }}@if (role.section) { · {{ role.section }} }</span>}</td>
                <td>
                  @for (m of u.modules; track m) {<span class="mod">{{ m }}</span>} @empty {<span class="a-muted a-small">Nothing</span>}
                </td>
                <td class="a-small">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM y, HH:mm') : 'Never' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="a-empty">No staff match.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (creating()) {
      <div class="a-modal-backdrop" (click)="creating.set(false)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-label="New role" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <h2>New role</h2>
          <label class="a-field"><span>Role name</span><input class="a-input" name="name" maxlength="100" required placeholder="e.g. Admissions assistant" [(ngModel)]="newName" /></label>
          <label class="a-field"><span>Description <small class="a-muted">(optional)</small></span><input class="a-input" name="desc" maxlength="255" placeholder="What this person does" [(ngModel)]="newDescription" /></label>
          <label class="a-field"><span>Start with the permissions of</span>
            <select class="a-select" name="copy" [(ngModel)]="newCopyFrom">
              <option [ngValue]="null">Nothing (tick them next)</option>
              @for (r of matrix()?.roles ?? []; track r.key) {<option [ngValue]="r.key">{{ r.name }}</option>}
            </select>
          </label>
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit">Create role</button>
            <button class="a-btn" type="button" (click)="creating.set(false)">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; } .head h1 { margin: 0 0 0.25rem; } .head p { margin: 0; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .chip { padding: 0.45rem 0.95rem; border-radius: 999px; border: 1px solid var(--a-line); background: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .chip--on { background: var(--a-primary); border-color: var(--a-primary); color: #fff; }
    .layout { display: grid; gap: 1rem; align-items: start; }
    @media (min-width: 980px) { .layout { grid-template-columns: 17rem 1fr; } .roles { position: sticky; top: 1rem; } }
    .roles { padding: 0.5rem; }
    .roles ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
    .role { width: 100%; display: grid; gap: 0.1rem; text-align: left; padding: 0.6rem 0.75rem; border: 0; border-radius: var(--a-radius-sm); background: none; font: inherit; color: inherit; cursor: pointer; }
    .role:hover { background: var(--a-bg); }
    .role--on, .role--on:hover { background: var(--a-primary-soft); box-shadow: inset 3px 0 0 var(--a-primary); }
    .role__name { font-weight: 650; }
    .role__meta { font-size: 0.8rem; color: var(--a-muted); }
    .lock { font-size: 0.75rem; margin-left: 0.2rem; }
    .new { width: 100%; margin-top: 0.5rem; }
    .editor { display: grid; gap: 1rem; min-width: 0; }
    .editor__head h2 { margin: 0; }
    .editor__head p { margin: 0.25rem 0 0; }
    .editor__head .a-alert { margin: 0.75rem 0 0; }
    .modules { display: grid; gap: 1rem; }
    @media (min-width: 1250px) { .modules { grid-template-columns: 1fr 1fr; } }
    .module { margin: 0; border: 1px solid var(--a-line); display: grid; gap: 0.35rem; align-content: start; }
    .module__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
    .module__head h4 { margin: 0; font-size: 1rem; }
    .section { grid-column: 1 / -1; margin: 0.5rem 0 -0.25rem; font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--a-muted); }
    .all { font-size: 0.85rem; }
    .perm { display: flex; gap: 0.65rem; align-items: flex-start; padding: 0.55rem 0.65rem; border-radius: var(--a-radius-sm); cursor: pointer; }
    .perm:hover { background: var(--a-bg); }
    .perm--on { background: var(--a-success-soft); }
    .perm input { margin-top: 0.2rem; width: 1.05rem; height: 1.05rem; flex: none; }
    .perm code { display: block; font-size: 0.75rem; color: var(--a-muted); }
    .savebar { position: sticky; bottom: 1rem; display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: center; border: 1px solid var(--a-primary); box-shadow: var(--a-shadow-lg); }
    .filters { margin-bottom: 1rem; } .filters .a-input { flex: 1 1 18rem; max-width: 28rem; }
    td .a-badge { margin: 0 0.25rem 0.25rem 0; }
    .mod { display: inline-block; margin: 0 0.3rem 0.3rem 0; padding: 0.1rem 0.55rem; border-radius: 999px; background: var(--a-primary-soft); color: var(--a-primary-strong); font-size: 0.8rem; font-weight: 600; }
    .off td { opacity: 0.6; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `,
})
export class AccessControl {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthStore);

  protected readonly tab = signal<Tab>('roles');
  protected readonly matrix = signal<AccessMatrix | null>(null);
  protected readonly review = signal<AccessReviewRow[]>([]);
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly draft = signal<Set<string>>(new Set());
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly saving = signal(false);
  protected readonly creating = signal(false);
  protected readonly renaming = signal(false);
  protected search = '';
  protected newName = '';
  protected newDescription = '';
  protected newCopyFrom: string | null = null;
  protected editName = '';
  protected editDescription = '';

  protected readonly canManage = computed(() => this.auth.can('access.manage'));
  protected readonly selected = computed(() => this.matrix()?.roles.find((r) => r.key === this.selectedKey()) ?? null);
  protected readonly editable = computed(() => this.canManage() && !this.selected()?.locked);

  /**
   * Permissions grouped by module, in catalogue order. "Admissions · Intakes" is the Intakes group
   * in the Admissions section; a module without " · " is a section of its own.
   */
  protected readonly groups = computed(() => {
    const out: { module: string; section: string; title: string; items: AccessMatrix['permissions']; keys: string[] }[] = [];
    for (const p of this.matrix()?.permissions ?? []) {
      if (p.key === ADMIN_ACCESS) continue;
      let g = out.find((x) => x.module === p.module);
      if (!g) {
        const [section, sub] = p.module.split(' · ');
        out.push((g = { module: p.module, section, title: sub ?? (section === 'Admissions' ? 'Applications' : section), items: [], keys: [] }));
      }
      g.items.push(p);
      g.keys.push(p.key);
    }
    return out;
  });

  private readonly saved = computed(() => new Set((this.selected()?.permissions ?? []).filter((k) => k !== ADMIN_ACCESS)));
  protected readonly dirty = computed(() => {
    const a = this.saved();
    const b = this.draft();
    return a.size !== b.size || [...a].some((k) => !b.has(k));
  });
  protected readonly changeSummary = computed(() => {
    const added = [...this.draft()].filter((k) => !this.saved().has(k)).length;
    const removed = [...this.saved()].filter((k) => !this.draft().has(k)).length;
    return [added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(', ');
  });

  protected filteredReview() {
    const q = this.search.trim().toLowerCase();
    return q
      ? this.review().filter((u) => [u.fullName, u.email, ...u.roles.map((r) => r.name)].some((v) => v.toLowerCase().includes(q)))
      : this.review();
  }

  constructor() {
    inject(Title).setTitle('Access control | Admin');
    void this.load();
  }

  private async load(selectKey?: string) {
    try {
      const m = await this.api.accessMatrix();
      this.matrix.set(m);
      const key = selectKey ?? this.selectedKey() ?? m.roles.find((r) => !r.locked)?.key ?? m.roles[0]?.key ?? null;
      this.selectedKey.set(key);
      this.resetDraft();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  private resetDraft() {
    this.draft.set(new Set(this.saved()));
  }

  protected async showReview() {
    this.tab.set('review');
    try {
      this.review.set(await this.api.accessReview());
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected countLabel(r: Role) {
    const n = r.permissions.filter((k) => k !== ADMIN_ACCESS).length;
    return n ? `${n} permission${n === 1 ? '' : 's'}` : 'no permissions';
  }

  protected select(key: string) {
    if (key === this.selectedKey()) return;
    if (this.dirty() && !confirm('Discard the unsaved changes to this role?')) return;
    this.selectedKey.set(key);
    this.renaming.set(false);
    this.message.set(null);
    this.resetDraft();
  }

  protected toggle(key: string, on: boolean) {
    const next = new Set(this.draft());
    if (on) next.add(key);
    else next.delete(key);
    this.draft.set(next);
  }

  protected allOn(keys: string[]) {
    return keys.every((k) => this.draft().has(k));
  }

  protected someOn(keys: string[]) {
    return !this.allOn(keys) && keys.some((k) => this.draft().has(k));
  }

  protected setAll(keys: string[], on: boolean) {
    const next = new Set(this.draft());
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    this.draft.set(next);
  }

  protected undo() {
    this.resetDraft();
  }

  protected async save(r: Role) {
    this.saving.set(true);
    try {
      const res = await this.api.setRolePermissions(r.key, [...this.draft()]);
      const parts = [res.added.length && `${res.added.length} added`, res.removed.length && `${res.removed.length} removed`].filter(Boolean);
      this.message.set({ kind: 'success', text: `${r.name} saved${parts.length ? ` (${parts.join(', ')})` : ''}. It applies to the ${r.people} ${r.people === 1 ? 'person' : 'people'} with this role straight away.` });
      await this.load(r.key);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.saving.set(false);
    }
  }

  protected openCreate() {
    if (this.dirty() && !confirm('Discard the unsaved changes to this role?')) return;
    this.newName = this.newDescription = '';
    this.newCopyFrom = null;
    this.creating.set(true);
  }

  protected async create() {
    try {
      const role = await this.api.createRole({ name: this.newName.trim(), description: this.newDescription.trim() || null, copyFrom: this.newCopyFrom });
      this.creating.set(false);
      this.message.set({ kind: 'success', text: `${role.name} created. Tick what it may do, then save. Give it to people in Staff users.` });
      await this.load(role.key);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
      this.creating.set(false);
    }
  }

  protected startRename(r: Role) {
    this.editName = r.name;
    this.editDescription = r.description ?? '';
    this.renaming.set(true);
  }

  protected async saveDetails(r: Role) {
    try {
      await this.api.updateRole(r.key, { name: this.editName.trim(), description: this.editDescription.trim() || null });
      this.renaming.set(false);
      await this.load(r.key);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected async remove(r: Role) {
    if (!confirm(`Delete the ${r.name} role? This cannot be undone.`)) return;
    try {
      await this.api.deleteRole(r.key);
      this.message.set({ kind: 'success', text: `${r.name} deleted.` });
      this.selectedKey.set(null);
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}
