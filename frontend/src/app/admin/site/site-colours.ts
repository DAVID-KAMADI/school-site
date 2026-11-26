import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import {
  DEFAULT_THEME,
  checkTheme,
  COLOUR_SWATCHES,
  colourName,
  darkenUntil,
  footerOf,
  isHex,
  normalise,
  sameTheme,
  themeTokens,
  THEME_PRESETS,
  type ThemeColors,
} from '../../core/theme';
import { AdminApi } from '../api';
import { toastChannel } from '../toast';


type ColourKey = keyof ThemeColors;

const FIELDS: { key: ColourKey; label: string; help: string }[] = [
  { key: 'primary', label: 'Main colour', help: 'Header, page banners and coloured sections.' },
  { key: 'action', label: 'Buttons & links', help: 'Main buttons, links and selected tabs.' },
  { key: 'accent', label: 'Highlight', help: '“Apply now”, small labels, underlines and focus rings.' },
  { key: 'footer', label: 'Footer & top bar', help: 'The strip at the very top and the footer.' },
];

/**
 * Admin → Site colours: four colours that the whole public website (every page, the Apply portal,
 * pop-ups, the maintenance page) is drawn with. Lighter and darker shades are worked out automatically.
 */
@Component({
  selector: 'app-site-colours',
  imports: [DecimalPipe],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Site colours</h1>
        <p class="a-muted">
          Choose the colours of the public website. Every page, the Apply portal, pop-ups and the maintenance page
          follow them; lighter and darker shades are worked out for you. The admin keeps its own colours.
        </p>
      </div>
      <a class="a-btn" href="/" target="_blank" rel="noopener">View the website</a>
    </div>

    @if (draft(); as d) {
      <section class="a-panel presets" aria-labelledby="presets-h">
        <h2 id="presets-h">Start from a colour set</h2>
        <div class="preset-list">
          @for (p of presets; track p.name) {
            <button type="button" class="preset" [class.preset--on]="isCurrent(p.colors)" (click)="use(p.colors)" [attr.aria-pressed]="isCurrent(p.colors)">
              <span class="preset__sw">
                <i [style.background]="p.colors.primary"></i>
                <i [style.background]="p.colors.action"></i>
                <i [style.background]="p.colors.accent"></i>
                <i [style.background]="p.colors.footer || p.colors.primary"></i>
              </span>
              <span>{{ p.name }}</span>
            </button>
          }
        </div>
      </section>

      <div class="layout">
        <form class="a-panel a-stack" (submit)="$event.preventDefault(); save()">
          <h2>Your colours</h2>
          <p class="a-help pick-hint">Click a colour below to change it.</p>
          <div class="mine" role="tablist" aria-label="Your colours">
            @for (f of fields; track f.key) {
              <button
                type="button"
                role="tab"
                class="mine__item"
                [class.on]="editing() === f.key"
                [attr.aria-selected]="editing() === f.key"
                (click)="editing.set(f.key)"
              >
                <span class="mine__sw" [style.background]="shown(f.key)">
                  @if (problem(f.key)) {
                    <span class="mine__warn" title="Hard to read">!</span>
                  }
                </span>
                <span class="mine__txt">
                  <b>{{ f.label }}</b>
                  <small>{{ nameOf(f.key) }}</small>
                </span>
              </button>
            }
          </div>

          @if (field(); as f) {
            <div class="pick" role="tabpanel" [attr.aria-label]="f.label">
              <div>
                <h3>{{ f.label }}</h3>
                <p class="a-help">{{ f.help }}</p>
              </div>
              <div class="swatches">
                @if (f.key === 'footer') {
                  <button type="button" class="sw" [class.sw--on]="!d.footer" [attr.aria-pressed]="!d.footer" (click)="toggleAutoFooter(true)">
                    <span class="sw__dot" [style.background]="autoFooter()"><span class="sw__tick" aria-hidden="true">✓</span></span>
                    <span class="sw__name">Automatic</span>
                  </button>
                }
                @for (s of swatches(); track s.hex) {
                  <button type="button" class="sw" [class.sw--on]="isPicked(f.key, s.hex)" [attr.aria-pressed]="isPicked(f.key, s.hex)" (click)="set(f.key, s.hex)">
                    <span class="sw__dot" [style.background]="s.hex"><span class="sw__tick" aria-hidden="true">✓</span></span>
                    <span class="sw__name">{{ s.name }}</span>
                  </button>
                }
                <label class="sw" [class.sw--on]="isCustom(f.key)" title="Pick any colour">
                  <span class="sw__dot sw__dot--any" [style.--now]="shown(f.key)">
                    <input type="color" [value]="shown(f.key)" (input)="set(f.key, $any($event.target).value)" [attr.aria-label]="'Pick any colour for ' + f.label" />
                    <span class="sw__tick" aria-hidden="true">✓</span>
                  </span>
                  <span class="sw__name">Any colour…</span>
                </label>
              </div>
              <details class="code">
                <summary>I have an exact colour code</summary>
                <div class="code__row">
                  <input
                    class="a-input"
                    [attr.aria-label]="f.label + ' colour code'"
                    [value]="shown(f.key)"
                    maxlength="7"
                    spellcheck="false"
                    placeholder="#0033a0"
                    (change)="typed(f.key, $any($event.target))"
                  />
                  <span class="a-help">From a logo or brand guide, e.g. #0033a0.</span>
                </div>
              </details>
            </div>
          }

          <div class="checks" aria-live="polite">
            <h3>Easy to read?</h3>
            <ul>
              @for (c of checks(); track c.key) {
                <li [class.bad]="!c.ok">
                  <span class="mark" aria-hidden="true">{{ c.ok ? '✓' : '!' }}</span>
                  <span>{{ c.label }} <small class="a-muted">{{ c.ratio | number: '1.1-1' }}:1{{ c.ok ? '' : ' — needs 4.5:1' }}</small></span>
                  @if (!c.ok) {
                    <button type="button" class="a-btn a-btn--sm" (click)="fix(c.key)">Make readable</button>
                  }
                </li>
              }
            </ul>
          </div>

          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="saving() || !changed() || !readable()">
              {{ saving() ? 'Saving…' : 'Save colours' }}
            </button>
            @if (changed()) {
              <button class="a-btn" type="button" (click)="undo()">Undo changes</button>
            }
            @if (!isCurrent(original)) {
              <button class="a-btn" type="button" (click)="use(original)">Back to original colours</button>
            }
          </div>
          @if (!readable()) {
            <p class="a-help">Fix the colours marked above before saving, so every visitor can read the site.</p>
          } @else if (changed()) {
            <p class="a-help">Not saved yet: the preview shows how the site will look.</p>
          }
        </form>

        <section class="a-panel preview-panel" aria-labelledby="preview-h">
          <h2 id="preview-h">Preview</h2>
          <div class="pv" [attr.style]="previewStyle()" aria-hidden="true">
            <div class="pv__top">+254 700 000 000 <span>Fees · Library · Visit</span></div>
            <div class="pv__head">
              <strong>{{ institution() }}</strong>
              <span class="pv__nav">About us · Academics · Admissions</span>
              <span class="pv__apply">Apply now</span>
            </div>
            <div class="pv__hero">
              <span class="pv__eyebrow">Admissions</span>
              <b>Apply for admission</b>
              <span>Practical, career-focused courses.</span>
            </div>
            <div class="pv__body">
              <span class="pv__label">Upcoming event</span>
              <b class="pv__title">Open day on campus</b>
              <p>Meet lecturers and tour the labs. <u class="pv__link">Read more</u></p>
              <div class="pv__tabs"><span class="on">Sign in</span><span>Create account</span></div>
              <div class="pv__buttons">
                <span class="pv__btn">Sign in and continue</span>
                <span class="pv__btn pv__btn--accent">Apply now</span>
              </div>
              <div class="pv__card">
                <span class="pv__tick">✓</span> Your KCSE results and documents
              </div>
            </div>
            <div class="pv__foot">
              <b>Contact us</b>
              <span>Nairobi, Kenya · info@example.ac.ke</span>
            </div>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .head { align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .head p { max-width: 60rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }
    h3 { font-size: 0.95rem; margin: 0 0 0.5rem; }
    .presets { margin-bottom: 1rem; }
    .preset-list { display: grid; gap: 0.6rem; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); }
    .preset {
      display: grid; gap: 0.45rem; padding: 0.6rem; text-align: left; font: inherit; font-size: 0.86rem; font-weight: 600;
      background: #fff; border: 1px solid var(--a-line, #dde3ec); border-radius: 10px; cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
    }
    .preset:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgb(16 24 40 / 0.08); }
    .preset--on { border-color: var(--a-primary); box-shadow: inset 0 0 0 1px var(--a-primary); }
    .preset__sw { display: flex; height: 1.6rem; border-radius: 6px; overflow: hidden; }
    .preset__sw i { flex: 1; }
    .preset__sw i:first-child { flex: 2; }

    .layout { display: grid; gap: 1rem; align-items: start; }
    @media (min-width: 1100px) { .layout { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); } .preview-panel { position: sticky; top: 1rem; } }
    .layout > .a-panel + .a-panel { margin-top: 0; }

    .pick-hint { margin: -0.5rem 0 0; }

    /* "Your colours": a small preview of the four choices, and the way to pick which one to change. */
    .mine { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); }
    .mine__item {
      display: flex; gap: 0.6rem; align-items: center; padding: 0.5rem; text-align: left; font: inherit;
      background: #fff; border: 1px solid var(--a-line, #dde3ec); border-radius: 10px; cursor: pointer;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .mine__item:hover { border-color: var(--a-primary); }
    .mine__item.on { border-color: var(--a-primary); box-shadow: inset 0 0 0 1px var(--a-primary), 0 4px 12px rgb(16 24 40 / 0.08); }
    .mine__sw { position: relative; flex: none; width: 2.6rem; height: 2.6rem; border-radius: 8px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12); transition: background-color 0.25s; }
    .mine__warn { position: absolute; top: -0.35rem; right: -0.35rem; display: grid; place-items: center; width: 1.1rem; height: 1.1rem; border-radius: 50%; background: var(--a-danger, #b42318); color: #fff; font-size: 0.7rem; font-weight: 800; }
    .mine__txt { display: grid; min-width: 0; line-height: 1.25; }
    .mine__txt b { font-size: 0.85rem; }
    .mine__txt small { color: var(--a-muted, #5c6370); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Colour swatches with names: no colour codes needed. */
    .pick { display: grid; gap: 0.75rem; padding: 0.9rem; border-radius: 10px; background: var(--a-surface-2, #f6f8fb); }
    .pick h3 { margin: 0; }
    .pick .a-help { margin: 0.15rem 0 0; }
    .swatches { display: grid; gap: 0.6rem 0.4rem; grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr)); }
    .sw { display: grid; justify-items: center; gap: 0.3rem; padding: 0.2rem; font: inherit; background: none; border: 0; cursor: pointer; }
    .sw__dot {
      position: relative; display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15); transition: transform 0.15s, box-shadow 0.15s;
    }
    .sw:hover .sw__dot { transform: scale(1.08); }
    .sw:focus-visible { outline: none; }
    .sw:focus-visible .sw__dot, .sw:focus-within .sw__dot { outline: 3px solid var(--a-primary); outline-offset: 2px; }
    .sw__tick { opacity: 0; color: #fff; font-weight: 800; font-size: 1rem; text-shadow: 0 1px 2px rgb(0 0 0 / 0.5); }
    .sw--on .sw__dot { box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--a-text, #1d2027); }
    .sw--on .sw__tick { opacity: 1; }
    .sw__name { font-size: 0.74rem; line-height: 1.2; text-align: center; color: var(--a-text, #1d2027); }
    .sw--on .sw__name { font-weight: 700; }
    .sw__dot--any { background: conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #14b8a6, #3b82f6, #a855f7, #ec4899, #ef4444); }
    .sw--on .sw__dot--any { background: var(--now); }
    .sw__dot--any input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .code summary { cursor: pointer; font-size: 0.85rem; color: var(--a-muted, #5c6370); }
    .code__row { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-top: 0.5rem; }
    .code__row .a-input { width: 8rem; font-family: ui-monospace, Consolas, monospace; text-transform: lowercase; }

    .checks ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
    .checks li { display: flex; gap: 0.55rem; align-items: center; font-size: 0.9rem; }
    .checks li > span:nth-child(2) { flex: 1; }
    .mark { flex: none; display: grid; place-items: center; width: 1.3rem; height: 1.3rem; border-radius: 50%; font-size: 0.75rem; font-weight: 800; background: var(--a-success-soft, #e3f6ea); color: var(--a-success, #12733f); }
    .bad .mark { background: var(--a-danger-soft, #fdecea); color: var(--a-danger, #b42318); }

    /* The preview is drawn with the same colour variables as the website. */
    .pv { border: 1px solid #dfe3ea; border-radius: 12px; overflow: hidden; font-size: 0.85rem; color: #33373f; background: #fff; transition: all 0.25s; }
    .pv * { transition: background-color 0.25s, color 0.25s, border-color 0.25s; }
    .pv__top { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0.9rem; background: var(--primary-deep); color: rgb(255 255 255 / 0.85); font-size: 0.72rem; }
    .pv__head { display: flex; align-items: center; gap: 0.9rem; padding: 0.7rem 0.9rem; background: var(--primary); color: #fff; }
    .pv__head strong { font-size: 0.8rem; max-width: 9rem; line-height: 1.15; }
    .pv__nav { flex: 1; font-weight: 600; font-size: 0.76rem; }
    .pv__apply, .pv__btn--accent { padding: 0.35rem 0.8rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 0.76rem; }
    .pv__hero { display: grid; gap: 0.35rem; justify-items: start; padding: 1.2rem 0.9rem 1.4rem; background: var(--primary); color: rgb(255 255 255 / 0.9); border-top: 1px solid rgb(255 255 255 / 0.1); }
    .pv__hero b { color: #fff; font-size: 1.35rem; }
    .pv__eyebrow { padding: 0.15rem 0.55rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .pv__body { display: grid; gap: 0.5rem; padding: 1rem 0.9rem; background: var(--surface-2); }
    .pv__body p { margin: 0; }
    .pv__label { color: var(--accent-text); font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .pv__title { color: #1d2027; font-size: 1rem; }
    .pv__link { color: var(--action); font-weight: 600; }
    .pv__tabs { display: flex; gap: 1rem; border-bottom: 1px solid #dfe3ea; font-weight: 600; color: #5c6370; }
    .pv__tabs span { padding: 0.3rem 0; border-bottom: 3px solid transparent; }
    .pv__tabs .on { color: var(--action); border-bottom-color: var(--accent); }
    .pv__buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .pv__btn { padding: 0.45rem 0.9rem; border-radius: 8px; background: var(--action); color: #fff; font-weight: 700; font-size: 0.78rem; }
    .pv__card { display: flex; gap: 0.5rem; align-items: center; padding: 0.6rem 0.75rem; background: #fff; border-radius: 8px; border-left: 4px solid var(--accent); }
    .pv__tick { display: grid; place-items: center; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: var(--surface-3); color: var(--action); font-size: 0.7rem; font-weight: 800; }
    .pv__foot { display: grid; gap: 0.2rem; padding: 0.9rem; background: var(--primary-deep); color: rgb(255 255 255 / 0.8); font-size: 0.76rem; }
    .pv__foot b { color: #fff; }
  `,
})
export class SiteColours {
  private readonly api = inject(AdminApi);
  protected readonly message = toastChannel();
  protected readonly presets = THEME_PRESETS;
  protected readonly fields = FIELDS;
  protected readonly original = DEFAULT_THEME;

  /** What is saved on the server. */
  private readonly saved = signal<ThemeColors | null>(null);
  /** What is being edited (and previewed). */
  protected readonly draft = signal<ThemeColors | null>(null);
  protected readonly saving = signal(false);
  protected readonly institution = signal('Your institute');

  /** Which of the four colours the swatches below are changing. */
  protected readonly editing = signal<ColourKey>('primary');
  protected readonly field = computed(() => FIELDS.find((f) => f.key === this.editing())!);
  protected readonly swatches = computed(() => COLOUR_SWATCHES[this.editing()]);
  protected readonly autoFooter = computed(() => (this.draft() ? footerOf({ ...this.draft()!, footer: '' }) : ''));

  protected readonly checks = computed(() => (this.draft() ? checkTheme(this.draft()!) : []));
  protected readonly readable = computed(() => this.checks().every((c) => c.ok));
  protected readonly changed = computed(() => !!this.draft() && !!this.saved() && !sameTheme(this.draft()!, this.saved()!));
  protected readonly previewStyle = computed(() => {
    const d = this.draft();
    if (!d) return '';
    return Object.entries(themeTokens(d))
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
  });

  constructor() {
    inject(Title).setTitle('Site colours | Admin');
    void this.load();
  }

  private async load() {
    try {
      const t = normalise(await this.api.theme());
      this.saved.set(t);
      this.draft.set({ ...t });
      const site = await this.api.settings().catch(() => []);
      const name = site.find((s) => s.key === 'institution.name')?.value;
      if (typeof name === 'string' && name) this.institution.set(name);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  /** The colour shown for a field (the automatic footer shade when no footer colour is set). */
  protected shown(key: ColourKey): string {
    const d = this.draft()!;
    return key === 'footer' ? footerOf(d) : d[key];
  }

  /** The name shown under each of "Your colours". */
  protected nameOf(key: ColourKey): string {
    if (key === 'footer' && !this.draft()!.footer) return 'Automatic';
    return colourName(this.shown(key));
  }

  protected isPicked(key: ColourKey, hex: string): boolean {
    return this.draft()![key] === hex;
  }

  /** True when the colour is not one of the swatches (picked with "Any colour…" or a code). */
  protected isCustom(key: ColourKey): boolean {
    const v = this.draft()![key];
    return !!v && !COLOUR_SWATCHES[key].some((s) => s.hex === v);
  }

  protected problem(key: ColourKey): boolean {
    return this.checks().some((c) => c.key === key && !c.ok);
  }

  protected set(key: ColourKey, value: string) {
    if (!isHex(value)) return;
    this.draft.update((d) => ({ ...d!, [key]: value.toLowerCase() }));
  }

  /** A colour typed by hand: "#abc", "abc" and "#aabbcc" all work. */
  protected typed(key: ColourKey, input: HTMLInputElement) {
    let v = input.value.trim().toLowerCase();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    if (isHex(v)) this.set(key, v);
    else {
      input.value = this.shown(key);
      this.message.set({ kind: 'error', text: 'Write colours as six hex digits, e.g. #0033a0.' });
    }
  }

  protected toggleAutoFooter(auto: boolean) {
    this.draft.update((d) => ({ ...d!, footer: auto ? '' : footerOf(d!) }));
  }

  /** Darkens the colour just enough for white text (or links on white) to be easy to read. */
  protected fix(key: ColourKey) {
    const d = this.draft()!;
    this.editing.set(key);
    if (key === 'footer') this.draft.set({ ...d, footer: darkenUntil(footerOf(d)) });
    else this.set(key, darkenUntil(d[key]));
  }

  protected use(colors: ThemeColors) {
    this.draft.set({ ...colors });
  }

  protected isCurrent(colors: ThemeColors) {
    const d = this.draft();
    return !!d && sameTheme(d, colors);
  }

  protected undo() {
    this.draft.set({ ...this.saved()! });
  }

  async save() {
    const d = this.draft();
    if (!d || !this.readable()) return;
    this.saving.set(true);
    try {
      const t = normalise(await this.api.saveTheme(d));
      this.saved.set(t);
      this.draft.set({ ...t });
      this.message.set({ kind: 'success', text: 'Colours saved. The website shows them now (open pages update when reloaded).' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.saving.set(false);
    }
  }
}
