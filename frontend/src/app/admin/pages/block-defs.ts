/**
 * What editors can fill in for each block type. Mirrors backend/src/cms/blocks/block-schemas.ts,
 * which remains the source of truth (the API validates every save).
 */

export type FieldDef =
  | { key: string; label: string; kind: 'text'; max?: number; required?: boolean; help?: string }
  | { key: string; label: string; kind: 'textarea'; max?: number; required?: boolean; help?: string }
  | { key: string; label: string; kind: 'richtext'; help?: string }
  | { key: string; label: string; kind: 'media'; accept: 'image' | 'document' | 'video'; required?: boolean; help?: string }
  | { key: string; label: string; kind: 'mediaList'; max: number; help?: string }
  | { key: string; label: string; kind: 'link'; optional?: boolean; help?: string }
  | { key: string; label: string; kind: 'select'; options: { value: string | number; label: string }[]; help?: string }
  | { key: string; label: string; kind: 'checkbox'; help?: string }
  | { key: string; label: string; kind: 'checklist'; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; kind: 'number'; min?: number; max?: number; step?: number; help?: string }
  | { key: string; label: string; kind: 'list'; itemLabel: string; fields: FieldDef[]; min?: number; max?: number; newItem: () => Record<string, unknown>; titleKey?: string };

export interface BlockDef {
  type: string;
  label: string;
  description: string;
  fields: FieldDef[];
  defaults: () => Record<string, unknown>;
}

const link = () => ({ label: '', href: '', openInNewTab: false });
const background: FieldDef = {
  key: 'background',
  label: 'Background',
  kind: 'select',
  options: [
    { value: 'default', label: 'White' },
    { value: 'light', label: 'Light grey' },
    { value: 'dark', label: 'Dark (brand)' },
    { value: 'accent', label: 'Accent colour' },
  ],
};

export const BLOCK_DEFS: BlockDef[] = [
  {
    type: 'hero',
    label: 'Hero',
    description: 'Large opening section with a headline, photo or video and up to three buttons.',
    fields: [
      { key: 'eyebrow', label: 'Small label above the headline', kind: 'text', max: 80, help: 'Optional, e.g. “September intake now open”.' },
      { key: 'heading', label: 'Headline', kind: 'text', max: 120, required: true },
      { key: 'text', label: 'Supporting text', kind: 'textarea', max: 400 },
      { key: 'mediaId', label: 'Background photo', kind: 'media', accept: 'image' },
      { key: 'slides', label: 'More photos (slideshow)', kind: 'mediaList', max: 6, help: 'Photos fade from one to the next every few seconds. Visitors can pause them.' },
      { key: 'videoId', label: 'Background video', kind: 'media', accept: 'video', help: 'A short muted clip (MP4 or WebM, 10–20 seconds, ideally under 8 MB) that loops behind the headline. The background photo shows while it loads.' },
      { key: 'startWith', label: 'Show first', kind: 'select', options: [{ value: 'video', label: 'Video' }, { value: 'slideshow', label: 'Photo slideshow' }], help: 'Used when both a video and photos are set. Visitors can switch between them at any time.' },
      { key: 'height', label: 'Height', kind: 'select', options: [{ value: 'full', label: 'Full screen' }, { value: 'medium', label: 'Medium' }, { value: 'short', label: 'Short' }] },
      { key: 'videoUrl', label: 'YouTube or Vimeo link (optional)', kind: 'text', max: 300, help: 'Shown as a click-to-play video under the headline.' },
      { key: 'buttons', label: 'Buttons', kind: 'list', itemLabel: 'Button', max: 3, fields: linkFields(), newItem: link, titleKey: 'label' },
      { key: 'align', label: 'Text alignment', kind: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }] },
    ],
    defaults: () => ({ eyebrow: '', heading: 'New headline', text: '', mediaId: null, videoUrl: null, buttons: [], align: 'left', slides: [], videoId: null, startWith: 'video', height: 'medium' }),
  },
  {
    type: 'rich_text',
    label: 'Text',
    description: 'Paragraphs, headings, lists, links and tables.',
    fields: [{ key: 'html', label: 'Text', kind: 'richtext' }, background],
    defaults: () => ({ html: '<p>Write here…</p>', background: 'default' }),
  },
  {
    type: 'image',
    label: 'Image',
    description: 'A single photo with an optional caption.',
    fields: [
      { key: 'mediaId', label: 'Photo', kind: 'media', accept: 'image', required: true },
      { key: 'caption', label: 'Caption', kind: 'text', max: 300, help: 'Leave empty to use the caption from the media library.' },
      { key: 'size', label: 'Width', kind: 'select', options: [{ value: 'content', label: 'Text width' }, { value: 'wide', label: 'Wide' }, { value: 'full', label: 'Full screen width' }] },
    ],
    defaults: () => ({ mediaId: null, caption: '', size: 'content' }),
  },
  {
    type: 'image_text',
    label: 'Image with text',
    description: 'Photo beside a heading, text and optional button.',
    fields: [
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80, help: 'Optional, e.g. “Who we are”.' },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'html', label: 'Text', kind: 'richtext' },
      { key: 'mediaId', label: 'Photo', kind: 'media', accept: 'image', required: true },
      { key: 'imagePosition', label: 'Photo position', kind: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
      { key: 'button', label: 'Button', kind: 'link', optional: true },
      background,
    ],
    defaults: () => ({ heading: '', html: '<p>Describe this here…</p>', mediaId: null, imagePosition: 'left', button: null, background: 'default' }),
  },
  {
    type: 'gallery',
    label: 'Photo gallery',
    description: 'Grid of photos that open in a full-screen viewer.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      {
        key: 'items',
        label: 'Photos',
        kind: 'list',
        itemLabel: 'Photo',
        min: 1,
        max: 60,
        fields: [
          { key: 'mediaId', label: 'Photo', kind: 'media', accept: 'image', required: true },
          { key: 'caption', label: 'Caption', kind: 'text', max: 300 },
        ],
        newItem: () => ({ mediaId: null, caption: '' }),
        titleKey: 'caption',
      },
    ],
    defaults: () => ({ heading: '', items: [{ mediaId: null, caption: '' }] }),
  },
  {
    type: 'cards',
    label: 'Cards',
    description: 'A grid of cards, e.g. programmes, facilities or quick links.',
    fields: [
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80, help: 'Optional, e.g. “Who we are”.' },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'intro', label: 'Introduction', kind: 'textarea', max: 400 },
      { key: 'columns', label: 'Cards per row (desktop)', kind: 'select', options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] },
      { key: 'variant', label: 'Style', kind: 'select', options: [{ value: 'standard', label: 'Photo above text' }, { value: 'overlay', label: 'Text over photo' }, { value: 'tiles', label: 'Quick-link tiles (no photos)' }] },
      {
        key: 'items',
        label: 'Cards',
        kind: 'list',
        itemLabel: 'Card',
        min: 1,
        max: 24,
        fields: [
          { key: 'title', label: 'Title', kind: 'text', max: 120, required: true },
          { key: 'text', label: 'Text', kind: 'textarea', max: 400 },
          { key: 'mediaId', label: 'Photo', kind: 'media', accept: 'image' },
          { key: 'link', label: 'Link', kind: 'link', optional: true },
        ],
        newItem: () => ({ title: 'Card title', text: '', mediaId: null, link: null }),
        titleKey: 'title',
      },
      background,
    ],
    defaults: () => ({ eyebrow: '', heading: '', intro: '', columns: 3, variant: 'standard', items: [{ title: 'Card title', text: '', mediaId: null, link: null }], background: 'default' }),
  },
  {
    type: 'stats',
    label: 'Key facts',
    description: 'Big numbers that count up, with a label and context (e.g. "50% — of students receive financial aid").',
    fields: [
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80, help: 'Optional, e.g. “Who we are”.' },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      {
        key: 'items',
        label: 'Facts',
        kind: 'list',
        itemLabel: 'Fact',
        min: 1,
        max: 8,
        fields: [
          { key: 'value', label: 'Number', kind: 'text', max: 20, required: true },
          { key: 'label', label: 'Label', kind: 'text', max: 80, required: true },
          { key: 'context', label: 'Context', kind: 'text', max: 160, help: 'One line that makes the number meaningful.' },
        ],
        newItem: () => ({ value: '0', label: 'Label', context: '' }),
        titleKey: 'label',
      },
      background,
    ],
    defaults: () => ({ heading: '', items: [{ value: '0', label: 'Label', context: '' }], background: 'default' }),
  },
  {
    type: 'timeline',
    label: 'Timeline',
    description: 'History and milestones in date order.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      {
        key: 'items',
        label: 'Milestones',
        kind: 'list',
        itemLabel: 'Milestone',
        min: 1,
        max: 50,
        fields: [
          { key: 'date', label: 'Date or year', kind: 'text', max: 40, required: true },
          { key: 'title', label: 'Title', kind: 'text', max: 120, required: true },
          { key: 'text', label: 'Text', kind: 'textarea', max: 400 },
        ],
        newItem: () => ({ date: '', title: '', text: '' }),
        titleKey: 'title',
      },
    ],
    defaults: () => ({ heading: '', items: [{ date: '2000', title: 'Founded', text: '' }] }),
  },
  {
    type: 'cta',
    label: 'Call to action',
    description: 'A banner that asks visitors to do one thing (apply, visit, contact).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120, required: true },
      { key: 'text', label: 'Text', kind: 'textarea', max: 300 },
      { key: 'buttons', label: 'Buttons', kind: 'list', itemLabel: 'Button', min: 1, max: 2, fields: linkFields(), newItem: link, titleKey: 'label' },
      { key: 'background', label: 'Background', kind: 'select', options: [{ value: 'accent', label: 'Accent colour' }, { value: 'dark', label: 'Dark (brand)' }, { value: 'light', label: 'Light grey' }] },
    ],
    defaults: () => ({ heading: 'Ready to apply?', text: '', buttons: [{ label: 'Apply now', href: '/', openInNewTab: false }], background: 'accent' }),
  },
  {
    type: 'faq',
    label: 'Questions & answers',
    description: 'Expandable list of frequently asked questions.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      {
        key: 'items',
        label: 'Questions',
        kind: 'list',
        itemLabel: 'Question',
        min: 1,
        max: 50,
        fields: [
          { key: 'question', label: 'Question', kind: 'text', max: 200, required: true },
          { key: 'answerHtml', label: 'Answer', kind: 'richtext' },
        ],
        newItem: () => ({ question: 'Question?', answerHtml: '<p>Answer.</p>' }),
        titleKey: 'question',
      },
    ],
    defaults: () => ({ heading: 'Frequently asked questions', items: [{ question: 'Question?', answerHtml: '<p>Answer.</p>' }] }),
  },
  {
    type: 'tabs',
    label: 'Tabs',
    description: 'Content split into tabs (e.g. Undergraduate / Postgraduate).',
    fields: [
      {
        key: 'items',
        label: 'Tabs',
        kind: 'list',
        itemLabel: 'Tab',
        min: 2,
        max: 8,
        fields: [
          { key: 'title', label: 'Tab title', kind: 'text', max: 60, required: true },
          { key: 'html', label: 'Content', kind: 'richtext' },
        ],
        newItem: () => ({ title: 'Tab', html: '<p></p>' }),
        titleKey: 'title',
      },
    ],
    defaults: () => ({ items: [{ title: 'First', html: '<p></p>' }, { title: 'Second', html: '<p></p>' }] }),
  },
  {
    type: 'testimonial',
    label: 'Student story / quote',
    description: 'A quote from a student, alumnus or partner, with photo.',
    fields: [
      { key: 'quote', label: 'Quote', kind: 'textarea', max: 600, required: true },
      { key: 'name', label: 'Name', kind: 'text', max: 100, required: true },
      { key: 'role', label: 'Role (e.g. BSc Nursing, 2025)', kind: 'text', max: 120 },
      { key: 'mediaId', label: 'Photo', kind: 'media', accept: 'image', help: 'Make sure you have the person\'s consent.' },
    ],
    defaults: () => ({ quote: '', name: '', role: '', mediaId: null }),
  },
  {
    type: 'video',
    label: 'Video',
    description: 'A YouTube or Vimeo video with a heading, on its own or beside text.',
    fields: [
      { key: 'url', label: 'YouTube or Vimeo link', kind: 'text', max: 300, required: true },
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80, help: 'Optional, e.g. “Campus tour”.' },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120, help: 'The video’s title, shown on the page.' },
      {
        key: 'videoPosition',
        label: 'Layout',
        kind: 'select',
        options: [
          { value: 'center', label: 'Video on its own (centred)' },
          { value: 'left', label: 'Video on the left, text on the right' },
          { value: 'right', label: 'Video on the right, text on the left' },
        ],
      },
      { key: 'html', label: 'Text', kind: 'richtext', help: 'Optional. Shown beside the video, or under the heading when the video is on its own.' },
      { key: 'button', label: 'Button', kind: 'link', optional: true },
      { key: 'caption', label: 'Caption under the video', kind: 'text', max: 300 },
      { key: 'title', label: 'Name for screen readers', kind: 'text', max: 120, help: 'Optional. The heading is used when this is empty.' },
      background,
    ],
    defaults: () => ({ url: '', eyebrow: '', heading: '', videoPosition: 'center', html: '', button: null, caption: '', title: '', background: 'default' }),
  },
  {
    type: 'map',
    label: 'Map',
    description: 'Campus location map.',
    fields: [
      { key: 'label', label: 'Heading', kind: 'text', max: 120 },
      { key: 'lat', label: 'Latitude', kind: 'number', min: -90, max: 90, step: 0.000001, help: 'Right-click the place in Google Maps or OpenStreetMap to copy its coordinates.' },
      { key: 'lng', label: 'Longitude', kind: 'number', min: -180, max: 180, step: 0.000001 },
      { key: 'zoom', label: 'Zoom (3–20)', kind: 'number', min: 3, max: 20, step: 1 },
    ],
    defaults: () => ({ label: 'Find us', lat: -1.2921, lng: 36.8219, zoom: 16 }),
  },
  {
    type: 'downloads',
    label: 'Downloads',
    description: 'List of documents (fee structures, forms, handbooks).',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      {
        key: 'items',
        label: 'Documents',
        kind: 'list',
        itemLabel: 'Document',
        min: 1,
        max: 100,
        fields: [
          { key: 'title', label: 'Title', kind: 'text', max: 160, required: true },
          { key: 'mediaId', label: 'File', kind: 'media', accept: 'document', required: true },
        ],
        newItem: () => ({ title: '', mediaId: null }),
        titleKey: 'title',
      },
    ],
    defaults: () => ({ heading: 'Downloads', items: [{ title: '', mediaId: null }] }),
  },
  {
    type: 'contact_form',
    label: 'Contact details',
    description: 'Phone, WhatsApp, email, address and office hours from Site settings.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'intro', label: 'Introduction', kind: 'textarea', max: 400 },
      {
        key: 'recipient',
        label: 'Office',
        kind: 'select',
        options: ['general', 'admissions', 'finance', 'library', 'hostels'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
      },
    ],
    defaults: () => ({ heading: 'Contact us', intro: '', recipient: 'general' }),
  },
  {
    type: 'programmes',
    label: 'Programme list',
    description: 'Lists the programmes from Admissions setup in tabs by level, with an optional Short courses tab. Updates by itself.',
    fields: [
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80 },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'intro', label: 'Introduction', kind: 'textarea', max: 400 },
      {
        key: 'levels',
        label: 'Levels to show',
        kind: 'checklist',
        options: [
          { value: 'certificate', label: 'Certificate' },
          { value: 'diploma', label: 'Diploma' },
          { value: 'degree', label: 'Degree' },
          { value: 'postgraduate', label: 'Postgraduate' },
        ],
        help: 'Leave all unticked to show every level that has programmes.',
      },
      { key: 'showShortCourses', label: 'Add a Short courses tab', kind: 'checkbox', help: 'Short courses are managed in Admissions setup → Short courses.' },
      { key: 'enquiryLink', label: 'Short course button', kind: 'link', optional: true, help: 'E.g. “Enquire” linking to your contact page.' },
      background,
    ],
    defaults: () => ({ eyebrow: '', heading: 'Programmes we offer', intro: '', levels: [], showShortCourses: true, enquiryLink: { label: 'Enquire', href: '/contact-us', openInNewTab: false }, background: 'default' }),
  },
  {
    type: 'short_courses',
    label: 'Short courses',
    description: 'Cards for the short courses managed in Admissions setup. Updates by itself.',
    fields: [
      { key: 'eyebrow', label: 'Small label above the heading', kind: 'text', max: 80 },
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'intro', label: 'Introduction', kind: 'textarea', max: 400 },
      { key: 'category', label: 'Only this category', kind: 'text', max: 100, help: 'Optional. Type a category exactly as in Admissions setup, or leave empty for all courses.' },
      { key: 'enquiryLink', label: 'Button on each course', kind: 'link', optional: true, help: 'E.g. “Enquire” linking to your contact page.' },
      { key: 'limit', label: 'Maximum shown', kind: 'number', min: 1, max: 60, step: 1 },
      background,
    ],
    defaults: () => ({ eyebrow: '', heading: 'Short courses', intro: '', category: '', enquiryLink: { label: 'Enquire', href: '/contact-us', openInNewTab: false }, limit: 24, background: 'default' }),
  },
  {
    type: 'child_pages',
    label: 'Sub-page list',
    description: 'Automatically lists the published pages inside this page.',
    fields: [
      { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
      { key: 'style', label: 'Style', kind: 'select', options: [{ value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }] },
      { key: 'limit', label: 'Maximum shown', kind: 'number', min: 1, max: 50, step: 1 },
    ],
    defaults: () => ({ heading: '', style: 'cards', limit: 12 }),
  },
  { type: 'divider', label: 'Divider line', description: 'A thin line between sections.', fields: [], defaults: () => ({}) },
  {
    type: 'spacer',
    label: 'Space',
    description: 'Extra vertical space.',
    fields: [{ key: 'size', label: 'Size', kind: 'select', options: [{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }] }],
    defaults: () => ({ size: 'md' }),
  },
];

export const BLOCK_DEF_MAP = new Map(BLOCK_DEFS.map((d) => [d.type, d]));

function linkFields(): FieldDef[] {
  return [
    { key: 'label', label: 'Button text', kind: 'text', max: 60, required: true },
    { key: 'href', label: 'Link', kind: 'text', max: 500, required: true, help: 'A site address like /admissions, or a full https:// link.' },
  ];
}
