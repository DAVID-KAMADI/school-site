import { ageOn, meetsGrade, validateSection } from './application-schemas.js';

describe('application schemas', () => {
  it('compares KCSE grades', () => {
    expect(meetsGrade('C+', 'C-')).toBe(true);
    expect(meetsGrade('D+', 'C-')).toBe(false);
    expect(meetsGrade('C-', 'C-')).toBe(true);
    expect(meetsGrade(null, 'C-')).toBeNull();
    expect(meetsGrade('B', null)).toBe(true);
  });

  it('lets drafts be incomplete but rejects bad values', () => {
    expect(
      validateSection('personal', { firstName: 'Amina', phone: '' }, 'draft')
        .ok,
    ).toBe(true);
    const bad = validateSection('personal', { phone: '12345' }, 'draft');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.issues[0].path).toBe('phone');
  });

  it('requires every field on submission and normalises phone numbers', () => {
    expect(validateSection('nextOfKin', { name: 'Jane' }, 'complete').ok).toBe(
      false,
    );
    const ok = validateSection(
      'nextOfKin',
      { name: 'Jane W.', relationship: 'Mother', phone: '0712 345 678' },
      'complete',
    );
    expect(ok.ok && ok.data.phone).toBe('0712345678');
  });

  it('checks KCSE index numbers', () => {
    const r = validateSection(
      'education',
      { kcseIndexNumber: '1234' },
      'draft',
    );
    expect(r.ok).toBe(false);
  });

  it('counts age in whole years, birthdays included', () => {
    const on = new Date(2026, 9, 22); // 22 October 2026
    expect(ageOn('2010-10-22', on)).toBe(16);
    expect(ageOn('2010-10-23', on)).toBe(15);
    expect(ageOn('2010-11-01', on)).toBe(15);
    expect(ageOn('2010-01-31', on)).toBe(16);
  });

  it('turns away applicants younger than the minimum age', () => {
    const iso = (yearsAgo: number, extraDays = 0) => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - yearsAgo);
      d.setDate(d.getDate() + extraDays);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const tooYoung = validateSection(
      'personal',
      { dateOfBirth: iso(16, 1) },
      'draft',
      { minimumAge: 16 },
    );
    expect(tooYoung.ok).toBe(false);
    expect(!tooYoung.ok && tooYoung.issues[0]).toEqual({
      path: 'dateOfBirth',
      message: expect.stringMatching(
        /at least 16 years old .* you are 15, so you do not meet the age requirement/,
      ),
    });
    // Exactly 16 today is old enough.
    expect(
      validateSection('personal', { dateOfBirth: iso(16) }, 'draft', {
        minimumAge: 16,
      }).ok,
    ).toBe(true);
    // The minimum is a setting: 18 turns away a 17-year-old.
    expect(
      validateSection('personal', { dateOfBirth: iso(17) }, 'draft', {
        minimumAge: 18,
      }).ok,
    ).toBe(false);
    // Future dates and impossible ages are still caught as typos.
    const future = validateSection(
      'personal',
      { dateOfBirth: iso(-1) },
      'draft',
    );
    expect(!future.ok && future.issues[0].message).toBe(
      'Check the date of birth',
    );
  });
});
