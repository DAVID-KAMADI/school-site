import sanitizeHtml from 'sanitize-html';

/**
 * Cleans editor HTML down to a small, design-safe set of tags. Scripts, styles, event handlers,
 * iframes and inline styling are removed, so editors cannot break the design or inject code.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'h2',
      'h3',
      'h4',
      'strong',
      'em',
      'u',
      's',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'br',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'caption',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      th: ['scope', 'colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = { href: attribs.href ?? '' };
        if (attribs.target === '_blank')
          Object.assign(out, { target: '_blank', rel: 'noopener noreferrer' });
        return { tagName, attribs: out };
      },
    },
  }).trim();
}

/** Plain text from HTML, used for empty-content checks and search. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}
