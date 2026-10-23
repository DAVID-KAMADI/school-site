import { Component, forwardRef, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { FieldDef } from '../pages/block-defs';
import { MediaField } from './media-field';
import { RichTextEditor } from './rich-text-editor';

type Obj = Record<string, unknown>;
let uid = 0;

const LINK_FIELDS: FieldDef[] = [
  { key: 'label', label: 'Button text', kind: 'text', max: 60, required: true },
  { key: 'href', label: 'Link', kind: 'text', max: 500, required: true, help: 'A site address like /admissions, or a full https:// link.' },
];

/**
 * Renders the editable fields of a block (or of one item in a list) from its field definitions.
 * Edits the object in place and emits `changed` so the editor can refresh the preview and mark the page unsaved.
 */
@Component({
  selector: 'app-field-list',
  imports: [FormsModule, MediaField, RichTextEditor, forwardRef(() => FieldList)],
  templateUrl: './field-list.html',
  styleUrl: './field-list.scss',
})
export class FieldList {
  readonly fields = input.required<FieldDef[]>();
  readonly value = input.required<Obj>();
  /** "content.items.2": used to match server validation errors to fields. */
  readonly path = input('');
  readonly errors = input<Record<string, string>>({});
  readonly changed = output<void>();

  protected readonly id = `f${uid++}`;
  protected readonly linkFields = LINK_FIELDS;
  protected readonly openItems = signal<Set<string>>(new Set());

  protected set(key: string, v: unknown) {
    this.value()[key] = v;
    this.changed.emit();
  }

  protected get(key: string): unknown {
    return this.value()[key];
  }

  protected str(key: string): string {
    const v = this.value()[key];
    return typeof v === 'string' ? v : v == null ? '' : String(v);
  }

  protected num(key: string): number | null {
    const v = this.value()[key];
    return typeof v === 'number' ? v : null;
  }

  protected list(key: string): Obj[] {
    const v = this.value()[key];
    return Array.isArray(v) ? (v as Obj[]) : [];
  }

  protected numList(key: string): number[] {
    const v = this.value()[key];
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
  }

  /** Replacing an item with null (Remove) deletes it from the list. */
  protected setListItem(key: string, index: number, id: number | null) {
    const list = this.numList(key).slice();
    if (id === null) list.splice(index, 1);
    else list[index] = id;
    this.set(key, list);
  }

  protected addListItem(key: string, id: number | null) {
    if (id !== null) this.set(key, [...this.numList(key), id]);
  }

  protected link(key: string): Obj | null {
    const v = this.value()[key];
    return v && typeof v === 'object' ? (v as Obj) : null;
  }

  protected errorFor(key: string): string | undefined {
    return this.errors()[this.childPath(key)];
  }

  protected childPath(key: string | number): string {
    return this.path() ? `${this.path()}.${key}` : String(key);
  }

  protected setText(key: string, raw: string, nullable = false) {
    this.set(key, nullable && !raw.trim() ? null : raw);
  }

  protected setSelect(f: FieldDef & { kind: 'select' }, raw: string) {
    const isNumber = typeof f.options[0]?.value === 'number';
    this.set(f.key, isNumber ? Number(raw) : raw);
  }

  protected checked(key: string, value: string): boolean {
    const v = this.value()[key];
    return Array.isArray(v) && v.includes(value);
  }

  /** Keeps the chosen values in the order the options are listed. */
  protected toggleChecked(f: FieldDef & { kind: 'checklist' }, value: string, on: boolean) {
    const chosen = new Set((this.value()[f.key] as string[] | undefined) ?? []);
    if (on) chosen.add(value);
    else chosen.delete(value);
    this.set(f.key, f.options.map((o) => o.value).filter((v) => chosen.has(v)));
  }

  protected setNumber(key: string, raw: string) {
    this.set(key, raw === '' ? null : Number(raw));
  }

  protected toggleLink(key: string, on: boolean) {
    this.set(key, on ? { label: '', href: '', openInNewTab: false } : null);
  }

  protected addItem(f: FieldDef & { kind: 'list' }) {
    const items = this.list(f.key).slice();
    items.push(f.newItem());
    this.set(f.key, items);
    this.toggleItem(f.key, items.length - 1, true);
  }

  protected removeItem(key: string, index: number) {
    const items = this.list(key).slice();
    items.splice(index, 1);
    this.set(key, items);
  }

  protected moveItem(key: string, index: number, step: number) {
    const items = this.list(key).slice();
    const target = index + step;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    this.set(key, items);
  }

  protected isOpen(key: string, index: number) {
    return this.openItems().has(`${key}:${index}`);
  }

  protected toggleItem(key: string, index: number, force?: boolean) {
    const id = `${key}:${index}`;
    this.openItems.update((set) => {
      const next = new Set(set);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected itemTitle(f: FieldDef & { kind: 'list' }, item: Obj, index: number): string {
    const t = f.titleKey ? item[f.titleKey] : null;
    return typeof t === 'string' && t.trim() ? t : `${f.itemLabel} ${index + 1}`;
  }

  protected hasErrorsUnder(key: string, index: number): boolean {
    const prefix = `${this.childPath(key)}.${index}.`;
    return Object.keys(this.errors()).some((k) => k.startsWith(prefix));
  }
}
