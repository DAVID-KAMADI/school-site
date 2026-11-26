import {
  CdkDrag,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  transferArrayItem,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type PageIntroEdit, type StaffLevelRow, type StaffMemberRow } from '../api';
import { MediaField } from '../fields/media-field';
import { PageIntroEditor } from '../fields/page-intro-editor';
import { MediaCache } from '../media/media-cache';
import { toastChannel } from '../toast';

interface MemberEdit {
  id?: number;
  levelId: number;
  name: string;
  position: string;
  department: string;
  photoId: number | null;
  bio: string;
  email: string;
  phone: string;
  isPublished: boolean;
}

interface LevelEdit {
  id?: number;
  name: string;
  description: string;
}

/**
 * Admin → Staff hierarchy: the tiers of the institute (top first) and the people in each,
 * shown on the website's Our people page (/staff). Drag people to reorder them or move them to another tier.
 */
@Component({
  selector: 'app-staff-admin',
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, MediaField, PageIntroEditor],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Staff hierarchy</h1>
        <p class="a-muted">
          The leadership and staff shown on the
          <a href="/staff" target="_blank" rel="noopener">Our people page</a>, from the top of the
          institute down. Drag a person to change the order or to move them to another tier. Tiers
          with nobody on the website are not shown there.
        </p>
      </div>
      <div class="a-toolbar">
        <button class="a-btn" type="button" (click)="editLevel()">+ New tier</button>
        <button
          class="a-btn a-btn--primary"
          type="button"
          (click)="editMember(null)"
          [disabled]="!levels().length"
        >
          + Add person
        </button>
      </div>
    </div>

    @if (page(); as p) {
      <app-page-intro-editor [value]="p" [saver]="savePage" viewUrl="/staff" />
    }

    <div cdkDropListGroup>
      @for (level of levels(); track level.id; let t = $index; let last = $last) {
        <section class="a-panel tier">
          <header class="tier__head">
            <span class="tier__n">{{ t + 1 }}</span>
            <div class="tier__title">
              <h2>{{ level.name }}</h2>
              @if (level.description) {
                <p class="a-small a-muted">{{ level.description }}</p>
              }
            </div>
            <span class="a-small a-muted"
              >{{ membersOf(level.id).length }}
              {{ membersOf(level.id).length === 1 ? 'person' : 'people' }}</span
            >
            <div class="a-toolbar">
              <button
                class="a-btn a-btn--sm a-btn--icon"
                type="button"
                (click)="moveLevel(t, -1)"
                [disabled]="t === 0"
                aria-label="Move tier up"
                title="Move up"
              >
                ↑
              </button>
              <button
                class="a-btn a-btn--sm a-btn--icon"
                type="button"
                (click)="moveLevel(t, 1)"
                [disabled]="last"
                aria-label="Move tier down"
                title="Move down"
              >
                ↓
              </button>
              <button class="a-btn a-btn--sm" type="button" (click)="editLevel(level)">
                Rename
              </button>
              <button class="a-btn a-btn--sm" type="button" (click)="editMember(level.id)">
                + Person
              </button>
            </div>
          </header>
          <ul
            class="people"
            cdkDropList
            cdkDropListOrientation="mixed"
            [cdkDropListData]="level.id"
            (cdkDropListDropped)="drop($event)"
          >
            @for (m of membersOf(level.id); track m.id) {
              <li class="person" cdkDrag [cdkDragData]="m" [class.person--hidden]="!m.isPublished">
                <span class="person__photo">
                  @if (m.photo) {
                    <img [src]="m.photo.srcset[0]?.url ?? m.photo.url" alt="" draggable="false" />
                  } @else {
                    <span>{{ initials(m.name) }}</span>
                  }
                </span>
                <span class="person__text">
                  <strong>{{ m.name }}</strong>
                  <span class="a-small">{{ m.position }}</span>
                  @if (m.department) {
                    <span class="a-small a-muted">{{ m.department }}</span>
                  }
                  @if (!m.isPublished) {
                    <span class="a-badge">Hidden</span>
                  }
                </span>
                <button class="a-btn a-btn--sm" type="button" (click)="editMember(level.id, m)">
                  Edit
                </button>
              </li>
            } @empty {
              <li class="people__empty a-small a-muted">
                Nobody here yet. Add a person or drag someone into this tier.
              </li>
            }
          </ul>
        </section>
      } @empty {
        <div class="a-panel a-empty">
          No tiers yet. Create the first one, e.g. “Board of Governors”.
        </div>
      }
    </div>

    @if (member(); as e) {
      <div class="a-modal-backdrop" (click)="member.set(null)">
        <form
          class="a-modal a-stack"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="e.id ? 'Edit person' : 'Add person'"
          (click)="$event.stopPropagation()"
          (ngSubmit)="saveMember()"
        >
          <h2>{{ e.id ? 'Edit ' + e.name : 'Add a person' }}</h2>
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }
          <div class="a-row">
            <label class="a-field"
              ><span>Full name</span
              ><input
                class="a-input"
                name="name"
                maxlength="120"
                required
                placeholder="e.g. Dr. Jane Wanjiru"
                [(ngModel)]="e.name"
            /></label>
            <label class="a-field"
              ><span>Tier</span>
              <select class="a-select" name="levelId" [(ngModel)]="e.levelId">
                @for (l of levels(); track l.id) {
                  <option [ngValue]="l.id">{{ l.name }}</option>
                }
              </select>
            </label>
          </div>
          <div class="a-row">
            <label class="a-field"
              ><span>Position</span
              ><input
                class="a-input"
                name="position"
                maxlength="120"
                required
                placeholder="e.g. Principal"
                [(ngModel)]="e.position"
            /></label>
            <label class="a-field"
              ><span>Department or course area <small class="a-muted">(optional)</small></span
              ><input
                class="a-input"
                name="department"
                maxlength="120"
                placeholder="e.g. Health Sciences"
                [(ngModel)]="e.department"
            /></label>
          </div>
          <div class="a-field">
            <span class="a-label"
              >Photo
              <small class="a-muted"
                >(optional: a head-and-shoulders photo works best; without one, their initials are
                shown)</small
              ></span
            ><app-media-field [(value)]="e.photoId" kind="image" />
          </div>
          <label class="a-field"
            ><span
              >Short profile
              <small class="a-muted">(optional, shown when a visitor opens the card)</small></span
            >
            <textarea
              class="a-textarea"
              name="bio"
              rows="4"
              maxlength="2000"
              placeholder="Background, qualifications and responsibilities."
              [(ngModel)]="e.bio"
            ></textarea>
          </label>
          <div class="a-row">
            <label class="a-field"
              ><span>Public email <small class="a-muted">(optional)</small></span
              ><input
                class="a-input"
                type="email"
                name="email"
                maxlength="160"
                [(ngModel)]="e.email"
            /></label>
            <label class="a-field"
              ><span>Public phone <small class="a-muted">(optional)</small></span
              ><input
                class="a-input"
                name="phone"
                maxlength="40"
                placeholder="+254 …"
                [(ngModel)]="e.phone"
            /></label>
          </div>
          <p class="a-small a-muted">
            Email and phone are shown to everyone on the website. Leave them empty to keep them
            private.
          </p>
          <label class="a-check"
            ><input type="checkbox" name="isPublished" [(ngModel)]="e.isPublished" /> Show this
            person on the website</label
          >
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="saving()">Save</button>
            <button class="a-btn" type="button" (click)="member.set(null)">Cancel</button>
            @if (e.id) {
              <button class="a-btn a-btn--danger" type="button" (click)="removeMember(e)">
                Remove
              </button>
            }
          </div>
        </form>
      </div>
    }

    @if (level(); as l) {
      <div class="a-modal-backdrop" (click)="level.set(null)">
        <form
          class="a-modal a-stack"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="l.id ? 'Rename tier' : 'New tier'"
          (click)="$event.stopPropagation()"
          (ngSubmit)="saveLevel()"
        >
          <h2>{{ l.id ? 'Rename tier' : 'New tier' }}</h2>
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }
          <label class="a-field"
            ><span>Name</span
            ><input
              class="a-input"
              name="name"
              maxlength="80"
              required
              placeholder="e.g. Heads of department"
              [(ngModel)]="l.name"
          /></label>
          <label class="a-field"
            ><span>Description <small class="a-muted">(optional)</small></span
            ><input class="a-input" name="description" maxlength="300" [(ngModel)]="l.description"
          /></label>
          @if (!l.id) {
            <p class="a-small a-muted">New tiers go at the bottom. Use the arrows to move it up.</p>
          }
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="saving()">Save</button>
            <button class="a-btn" type="button" (click)="level.set(null)">Cancel</button>
            @if (l.id) {
              <button class="a-btn a-btn--danger" type="button" (click)="removeLevel(l)">
                Delete tier
              </button>
            }
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .head {
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .head p {
      max-width: 60rem;
    }
    .tier__head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.9rem;
    }
    .tier__n {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: #0033a0;
      color: #fff;
      font-weight: 700;
      flex: none;
    }
    .tier__title {
      flex: 1;
      min-width: 12rem;
    }
    .tier__title h2 {
      margin: 0;
      font-size: 1.05rem;
    }
    .tier__title p {
      margin: 0.15rem 0 0;
    }
    .people {
      list-style: none;
      margin: 0;
      padding: 0.5rem;
      min-height: 4.5rem;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
      border: 1px dashed var(--a-line);
      border-radius: 10px;
      background: #fafbfd;
    }
    .people.cdk-drop-list-receiving,
    .people.cdk-drop-list-dragging {
      border-color: #0345bf;
      background: #f1f5fd;
    }
    .people__empty {
      grid-column: 1 / -1;
      align-self: center;
      text-align: center;
      padding: 0.75rem;
    }
    .person {
      display: flex;
      gap: 0.7rem;
      align-items: center;
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--a-line);
      border-radius: 10px;
      background: #fff;
      cursor: grab;
    }
    .person--hidden {
      opacity: 0.6;
    }
    .person__photo {
      display: grid;
      place-items: center;
      flex: none;
      width: 2.9rem;
      height: 2.9rem;
      overflow: hidden;
      border-radius: 50%;
      background: linear-gradient(135deg, #0033a0, #0345bf);
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
    }
    .person__photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .person__text {
      display: grid;
      flex: 1;
      min-width: 0;
      line-height: 1.3;
    }
    .person__text > * {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .person__text .a-badge {
      justify-self: start;
      margin-top: 0.2rem;
    }
    .cdk-drag-preview {
      box-shadow: 0 12px 30px rgb(0 0 0 / 0.2);
    }
    .cdk-drag-placeholder {
      opacity: 0.35;
    }
    .cdk-drag-animating,
    .people.cdk-drop-list-dragging .person:not(.cdk-drag-placeholder) {
      transition: transform 0.25s cubic-bezier(0, 0, 0.2, 1);
    }
  `,
})
export class StaffAdmin {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  protected readonly message = toastChannel();
  protected readonly page = signal<PageIntroEdit | null>(null);
  protected readonly levels = signal<StaffLevelRow[]>([]);
  protected readonly members = signal<StaffMemberRow[]>([]);
  protected readonly member = signal<MemberEdit | null>(null);
  protected readonly level = signal<LevelEdit | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  private readonly byLevel = computed(() => {
    const map = new Map<number, StaffMemberRow[]>();
    for (const m of this.members()) map.set(m.levelId, [...(map.get(m.levelId) ?? []), m]);
    return map;
  });

  protected readonly savePage = async (v: PageIntroEdit) =>
    this.page.set(await this.api.saveStaffPage(v));

  constructor() {
    inject(Title).setTitle('Staff hierarchy | Admin');
    void this.load();
  }

  private async load() {
    try {
      const r = await this.api.staff();
      this.cache.add(...r.members.map((m) => m.photo));
      this.page.set(r.page);
      this.levels.set(r.levels);
      this.members.set(r.members);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected membersOf(levelId: number) {
    return this.byLevel().get(levelId) ?? [];
  }

  protected initials(name: string) {
    const parts = name
      .split(/\s+/)
      .filter((w) => w && !/^(dr|prof|mr|mrs|ms|miss|eng|rev|hon)\.?$/i.test(w));
    return (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  // ---------- Tiers ----------

  protected editLevel(l?: StaffLevelRow) {
    this.error.set('');
    this.level.set(
      l
        ? { id: l.id, name: l.name, description: l.description ?? '' }
        : { name: '', description: '' },
    );
  }

  async saveLevel() {
    const l = this.level();
    if (!l) return;
    await this.run(async () => {
      await this.api.saveStaffLevel(l.id ?? null, {
        name: l.name,
        description: l.description.trim() || null,
      });
      this.level.set(null);
      this.message.set({ kind: 'success', text: `Tier "${l.name}" saved.` });
    });
  }

  async removeLevel(l: LevelEdit) {
    if (!l.id || !confirm(`Delete the tier "${l.name}"?`)) return;
    await this.run(async () => {
      await this.api.deleteStaffLevel(l.id!);
      this.level.set(null);
      this.message.set({ kind: 'success', text: `Tier "${l.name}" deleted.` });
    });
  }

  async moveLevel(index: number, step: number) {
    const list = [...this.levels()];
    moveItemInArray(list, index, index + step);
    this.levels.set(list);
    try {
      await this.api.orderStaffLevels(list.map((l) => l.id));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
      await this.load();
    }
  }

  // ---------- People ----------

  protected editMember(levelId: number | null, m?: StaffMemberRow) {
    this.error.set('');
    this.member.set(
      m
        ? {
            id: m.id,
            levelId: m.levelId,
            name: m.name,
            position: m.position,
            department: m.department ?? '',
            photoId: m.photoId,
            bio: m.bio ?? '',
            email: m.email ?? '',
            phone: m.phone ?? '',
            isPublished: m.isPublished,
          }
        : {
            levelId: levelId ?? this.levels()[0].id,
            name: '',
            position: '',
            department: '',
            photoId: null,
            bio: '',
            email: '',
            phone: '',
            isPublished: true,
          },
    );
  }

  async saveMember() {
    const e = this.member();
    if (!e) return;
    await this.run(async () => {
      await this.api.saveStaffMember(e.id ?? null, {
        levelId: Number(e.levelId),
        name: e.name,
        position: e.position,
        department: e.department.trim() || null,
        photoId: e.photoId,
        bio: e.bio.trim() || null,
        email: e.email.trim() || null,
        phone: e.phone.trim() || null,
        isPublished: e.isPublished,
      });
      this.member.set(null);
      this.message.set({ kind: 'success', text: `${e.name} saved.` });
    });
  }

  async removeMember(e: MemberEdit) {
    if (
      !e.id ||
      !confirm(
        `Remove ${e.name} from the staff hierarchy? To hide them for now, untick "Show this person on the website" instead.`,
      )
    )
      return;
    await this.run(async () => {
      await this.api.deleteStaffMember(e.id!);
      this.member.set(null);
      this.message.set({ kind: 'success', text: `${e.name} removed.` });
    });
  }

  /** Dropped within a tier: new order. Dropped on another tier: moves there, at that place. */
  async drop(e: CdkDragDrop<number>) {
    const fromLevel = e.previousContainer.data;
    const toLevel = e.container.data;
    if (fromLevel === toLevel && e.previousIndex === e.currentIndex) return;
    const source = [...this.membersOf(fromLevel)];
    const target = fromLevel === toLevel ? source : [...this.membersOf(toLevel)];
    if (fromLevel === toLevel) moveItemInArray(source, e.previousIndex, e.currentIndex);
    else transferArrayItem(source, target, e.previousIndex, e.currentIndex);
    const moved: StaffMemberRow = e.item.data;
    // Show the new arrangement straight away, then save it.
    const updated = new Map([...source, ...target].map((m, i) => [m.id, i]));
    this.members.update((all) =>
      all
        .map((m) => (m.id === moved.id ? { ...m, levelId: toLevel } : m))
        .sort((a, b) => (updated.get(a.id) ?? a.sortOrder) - (updated.get(b.id) ?? b.sortOrder)),
    );
    try {
      if (fromLevel !== toLevel) {
        await this.api.saveStaffMember(moved.id, { ...memberBody(moved), levelId: toLevel });
        this.message.set({
          kind: 'success',
          text: `${moved.name} moved to ${this.levels().find((l) => l.id === toLevel)?.name}.`,
        });
      }
      await this.api.orderStaffMembers(target.map((m) => m.id));
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
      await this.load();
    }
  }

  private async run(fn: () => Promise<void>) {
    this.saving.set(true);
    this.error.set('');
    try {
      await fn();
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

function memberBody(m: StaffMemberRow) {
  return {
    levelId: m.levelId,
    name: m.name,
    position: m.position,
    department: m.department,
    photoId: m.photoId,
    bio: m.bio,
    email: m.email,
    phone: m.phone,
    isPublished: m.isPublished,
  };
}
