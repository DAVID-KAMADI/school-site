import { acceptBy, fillTemplate } from './offer-letter.service.js';

describe('offer letter helpers', () => {
  it('fills known placeholders and keeps unknown ones visible', () => {
    expect(
      fillTemplate('Dear {first_name}, welcome to {programme}. {typo}', {
        first_name: 'Amina',
        programme: 'BSc Nursing',
      }),
    ).toBe('Dear Amina, welcome to BSc Nursing. {typo}');
  });

  it('gives the end of the day N days after the decision', () => {
    const d = acceptBy(new Date('2026-10-01T09:00:00'), 14);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(23);
  });
});
