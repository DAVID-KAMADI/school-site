import { Component, input } from '@angular/core';

/** Layout shared by the analytics tabs. */
export const TAB_STYLES = `
  :host { display: block; }
  .grid { display: grid; gap: 1rem; }
  .kpis { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr)); margin-bottom: 1rem; }
  .kpis button { all: unset; display: block; cursor: pointer; border-radius: var(--a-radius); }
  .kpis button:focus-visible { outline: 2px solid var(--a-primary); outline-offset: 2px; }
  .two { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); margin-top: 1rem; }
  .three { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); margin-top: 1rem; }
  .a-panel + .a-panel { margin-top: 0; }
  .panel-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.85rem; }
  .panel-head h2 { margin: 0; }
  .panel-head p { margin: 0.15rem 0 0; }
  .seg { display: inline-flex; border: 1px solid var(--a-line-strong); border-radius: var(--a-radius-sm); overflow: hidden; }
  .seg button { border: 0; background: #fff; padding: 0.35rem 0.7rem; font: inherit; font-size: 0.84rem; color: var(--a-muted); cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--a-line); }
  .seg button.on { background: var(--a-primary-soft); color: var(--a-primary-strong); font-weight: 650; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .a-table th.num { text-align: right; }
  .path { max-width: 28rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .path small { display: block; color: var(--a-muted); overflow: hidden; text-overflow: ellipsis; }
  .row-btn { all: unset; cursor: pointer; color: var(--a-primary); }
  .row-btn:hover { text-decoration: underline; }
  .sk { border-radius: 10px; background: linear-gradient(90deg, #eef1f5, #f7f9fc, #eef1f5); background-size: 200% 100%; animation: sk 1.2s infinite linear; }
  @keyframes sk { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  .export { font-size: 0.84rem; }
  .note { margin: 0.75rem 0 0; }
`;

/** Placeholder while a report loads. */
@Component({
  selector: 'an-skeleton',
  template: `<div class="sk" [style.height.px]="height()" aria-hidden="true"></div><span class="sr">Loading…</span>`,
  styles: `
    .sk { border-radius: 10px; background: linear-gradient(90deg, #eef1f5, #f7f9fc, #eef1f5); background-size: 200% 100%; animation: sk 1.2s infinite linear; }
    @keyframes sk { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `,
})
export class Skeleton {
  readonly height = input(180);
}

/** Shown until the tracker has recorded the first visit: never invented numbers. */
@Component({
  selector: 'an-no-data',
  template: `
    <div class="a-panel empty">
      <h2>No visits recorded yet</h2>
      <p class="a-muted">
        The website now counts its own visits. Numbers appear here as soon as people open the public site.
        Visits from staff signed in to this portal are not counted, so to check it's working, open the website in a
        private window, or on your phone.
      </p>
    </div>
  `,
  styles: `.empty { text-align: center; padding: 2.5rem 1.5rem; } .empty p { max-width: 38rem; margin: 0 auto; }`,
})
export class NoData {}
