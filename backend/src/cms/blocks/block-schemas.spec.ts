import {
  BlockValidationError,
  collectMediaRefs,
  validateBlocks,
} from './block-schemas.js';

describe('block schemas', () => {
  it('fills defaults and keeps valid content', () => {
    const [hero] = validateBlocks([
      { type: 'hero', content: { heading: 'Welcome' } },
    ]);
    expect(hero.content).toEqual({
      eyebrow: '',
      heading: 'Welcome',
      text: '',
      mediaId: null,
      videoUrl: null,
      buttons: [],
      align: 'left',
      slides: [],
      videoId: null,
      startWith: 'video',
      height: 'full',
    });
  });

  it('strips scripts and unsafe links from rich text', () => {
    const [block] = validateBlocks([
      {
        type: 'rich_text',
        content: {
          html: '<p onclick="x()">Hi<script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="https://ok.ac.ke" target="_blank">ok</a></p><iframe src="https://evil"></iframe>',
        },
      },
    ]);
    const html = block.content.html as string;
    expect(html).not.toMatch(/script|onclick|javascript|iframe/);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('rejects unsafe button links, unknown types and non-allow-listed videos', () => {
    try {
      validateBlocks([
        {
          type: 'cta',
          content: {
            heading: 'Apply',
            buttons: [{ label: 'Go', href: 'javascript:alert(1)' }],
          },
        },
        { type: 'nope', content: {} },
        {
          type: 'video',
          content: { url: 'https://evil.example/video', title: 'x' },
        },
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BlockValidationError);
      const issues = (err as BlockValidationError).issues;
      expect(issues.map((i) => i.block)).toEqual([0, 1, 2]);
    }
  });

  it('finds slideshow media ids', () => {
    expect(collectMediaRefs({ mediaId: 1, slides: [2, 3] })).toEqual([
      { mediaId: 1, fieldPath: 'content.mediaId' },
      { mediaId: 2, fieldPath: 'content.slides.0' },
      { mediaId: 3, fieldPath: 'content.slides.1' },
    ]);
  });

  it('finds media references at any depth', () => {
    const refs = collectMediaRefs({
      mediaId: 1,
      items: [{ mediaId: 2 }, { mediaId: null }, { nested: { mediaId: 3 } }],
    });
    expect(refs).toEqual([
      { mediaId: 1, fieldPath: 'content.mediaId' },
      { mediaId: 2, fieldPath: 'content.items.0.mediaId' },
      { mediaId: 3, fieldPath: 'content.items.2.nested.mediaId' },
    ]);
  });

  it('keeps videos saved before headings and layouts existed', () => {
    const [video] = validateBlocks([
      {
        type: 'video',
        content: {
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          title: 'Campus tour',
          caption: 'Our campus',
        },
      },
    ]);
    expect(video.content).toMatchObject({
      title: 'Campus tour',
      caption: 'Our campus',
      heading: '',
      html: '',
      videoPosition: 'center',
      button: null,
      background: 'default',
    });
  });

  it('places a video beside text with a heading, and cleans the text', () => {
    const [video] = validateBlocks([
      {
        type: 'video',
        content: {
          url: 'https://youtu.be/abcdefghijk',
          heading: 'Take a campus tour',
          html: '<p>See our labs<script>alert(1)</script></p>',
          videoPosition: 'right',
          button: { label: 'Visit us', href: '/contact-us' },
        },
      },
    ]);
    expect(video.content).toMatchObject({
      heading: 'Take a campus tour',
      html: '<p>See our labs</p>',
      videoPosition: 'right',
      title: '',
    });
    expect(() =>
      validateBlocks([
        {
          type: 'video',
          content: {
            url: 'https://youtu.be/abcdefghijk',
            videoPosition: 'top',
          },
        },
      ]),
    ).toThrow(BlockValidationError);
  });
});
