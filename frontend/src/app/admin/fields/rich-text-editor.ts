import { Component, ElementRef, ViewEncapsulation, afterNextRender, input, model, viewChild, type OnDestroy } from '@angular/core';
import type Quill from 'quill';

/**
 * Formatted-text editor (Quill, BSD licence) with a deliberately small toolbar so content stays on-brand.
 * The API cleans the HTML again on save.
 */
@Component({
  selector: 'app-rich-text-editor',
  template: `<div class="rte"><div #host></div></div>`,
  styleUrls: ['../../../../node_modules/quill/dist/quill.snow.css', './rich-text-editor.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class RichTextEditor implements OnDestroy {
  readonly value = model('');
  readonly label = input('Text');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private quill: Quill | null = null;

  constructor() {
    afterNextRender(async () => {
      const { default: QuillCtor } = await import('quill');
      const quill = new QuillCtor(this.host().nativeElement, {
        theme: 'snow',
        modules: {
          toolbar: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'link'], ['clean']],
        },
      });
      quill.clipboard.dangerouslyPasteHTML(this.value() || '', 'silent');
      quill.root.setAttribute('aria-label', this.label());
      quill.root.setAttribute('role', 'textbox');
      quill.root.setAttribute('aria-multiline', 'true');
      quill.on('text-change', () => {
        const html = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
        this.value.set(quill.getText().trim() ? html : '');
      });
      this.quill = quill;
    });
  }

  ngOnDestroy(): void {
    this.quill?.off('text-change');
    this.quill = null;
  }
}
