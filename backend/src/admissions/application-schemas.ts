import { z } from 'zod';

/** KCSE grades from highest to lowest. */
export const KCSE_GRADES = [
  'A',
  'A-',
  'B+',
  'B',
  'B-',
  'C+',
  'C',
  'C-',
  'D+',
  'D',
  'D-',
  'E',
] as const;

/** True when `grade` is at least `minimum` (e.g. C+ meets C-). */
export function meetsGrade(
  grade: string | null | undefined,
  minimum: string | null | undefined,
): boolean | null {
  if (!minimum) return true;
  if (!grade) return null;
  const g = KCSE_GRADES.indexOf(grade as (typeof KCSE_GRADES)[number]);
  const m = KCSE_GRADES.indexOf(minimum as (typeof KCSE_GRADES)[number]);
  if (g < 0 || m < 0) return null;
  return g <= m;
}

export const COUNTIES = [
  'Baringo',
  'Bomet',
  'Bungoma',
  'Busia',
  'Elgeyo-Marakwet',
  'Embu',
  'Garissa',
  'Homa Bay',
  'Isiolo',
  'Kajiado',
  'Kakamega',
  'Kericho',
  'Kiambu',
  'Kilifi',
  'Kirinyaga',
  'Kisii',
  'Kisumu',
  'Kitui',
  'Kwale',
  'Laikipia',
  'Lamu',
  'Machakos',
  'Makueni',
  'Mandera',
  'Marsabit',
  'Meru',
  'Migori',
  'Mombasa',
  "Murang'a",
  'Nairobi',
  'Nakuru',
  'Nandi',
  'Narok',
  'Nyamira',
  'Nyandarua',
  'Nyeri',
  'Samburu',
  'Siaya',
  'Taita-Taveta',
  'Tana River',
  'Tharaka-Nithi',
  'Trans Nzoia',
  'Turkana',
  'Uasin Gishu',
  'Vihiga',
  'Wajir',
  'West Pokot',
  'Outside Kenya',
] as const;

/** RCMRD's 20 contracting member states: listed first in the application form. */
export const RCMRD_MEMBER_STATES = [
  'Botswana',
  'Burundi',
  'Comoros',
  'Eswatini',
  'Ethiopia',
  'Kenya',
  'Lesotho',
  'Malawi',
  'Mauritius',
  'Namibia',
  'Rwanda',
  'Seychelles',
  'Somalia',
  'South Africa',
  'South Sudan',
  'Sudan',
  'Tanzania',
  'Uganda',
  'Zambia',
  'Zimbabwe',
] as const;

export const OTHER_COUNTRIES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Costa Rica',
  "Côte d'Ivoire",
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czechia',
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Republic of the Congo',
  'Romania',
  'Russia',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'São Tomé and Príncipe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'South Korea',
  'Spain',
  'Sri Lanka',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Tajikistan',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Venezuela',
  'Vietnam',
  'Yemen',
] as const;

export const COUNTRIES = [...RCMRD_MEMBER_STATES, ...OTHER_COUNTRIES] as const;

export const STUDY_MODES = [
  'full_time',
  'part_time',
  'evening',
  'weekend',
] as const;
export const FUNDING_METHODS = [
  'self',
  'parent_guardian',
  'helb',
  'bursary',
  'sponsor',
  'scholarship',
] as const;

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min ? 'Required' : undefined)
    .max(max);
/** Kenyan mobile (07…, 01…, +2547…, +2541…) or an international number. */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine(
    (v) => /^(?:\+254|0)[17]\d{8}$/.test(v) || /^\+\d{8,15}$/.test(v),
    'Enter a valid phone number, e.g. 0712 345 678',
  );

/** Whole years from a YYYY-MM-DD birth date to `on` (today by default), counting birthdays. */
export function ageOn(iso: string, on: Date = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number);
  let years = on.getFullYear() - y;
  if (on.getMonth() + 1 < m || (on.getMonth() + 1 === m && on.getDate() < d))
    years--;
  return years;
}

/** Applicants younger than this cannot be admitted (Site settings → Admissions → Minimum age). */
export const DEFAULT_MINIMUM_AGE = 16;

export const SECTION_SCHEMAS = {
  programme: z.object({
    intakeId: z.number().int().positive(),
    programmeId: z.number().int().positive(),
    studyMode: z.enum(STUDY_MODES),
  }),
  personal: z.object({
    firstName: text(1, 60),
    middleName: text(0, 60).default(''),
    lastName: text(1, 60),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
      // The minimum age is a setting, checked in validateSection; this only catches typos.
      .refine(
        (v) => ageOn(v) >= 0 && ageOn(v) <= 100,
        'Check the date of birth',
      ),
    gender: z.enum(['female', 'male', 'prefer_not_to_say']),
    nationality: text(2, 60),
    idType: z.enum([
      'national_id',
      'birth_certificate',
      'passport',
      'alien_id',
    ]),
    idNumber: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9-]{4,20}$/,
        'Enter the number as printed on the document',
      ),
    phone,
    country: z.enum(COUNTRIES, { message: 'Choose your country' }),
    // County for applicants living in Kenya (required for them, see validateSection); region or city elsewhere.
    county: z.union([z.literal(''), z.enum(COUNTIES)]).default(''),
    region: text(0, 100).default(''),
    address: text(3, 300),
    disability: text(0, 300).default(''),
  }),
  nextOfKin: z.object({
    name: text(2, 120),
    relationship: text(2, 60),
    phone,
    email: z
      .union([z.literal(''), z.string().trim().email('Enter a valid email')])
      .default(''),
  }),
  education: z.object({
    kcseIndexNumber: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'KCSE index numbers have 11 digits'),
    kcseYear: z.number().int().min(1989).max(new Date().getFullYear()),
    meanGrade: z.enum(KCSE_GRADES),
    secondarySchool: text(2, 150),
    subjects: z
      .array(z.object({ subject: text(2, 60), grade: z.enum(KCSE_GRADES) }))
      .max(12)
      .default([]),
    otherQualifications: z
      .array(
        z.object({
          institution: text(2, 150),
          qualification: text(2, 150),
          year: z.number().int().min(1980).max(2100),
        }),
      )
      .max(6)
      .default([]),
  }),
  funding: z.object({
    method: z.enum(FUNDING_METHODS),
    sponsorName: text(0, 150).default(''),
  }),
} as const;

/** Shown when the applicant is younger than the minimum age. */
export function tooYoungMessage(minimumAge: number, age: number): string {
  return `You must be at least ${minimumAge} years old to be admitted. With this date of birth you are ${age}, so you do not meet the age requirement.`;
}

export type SectionKey = keyof typeof SECTION_SCHEMAS;
export const SECTION_KEYS = Object.keys(SECTION_SCHEMAS) as SectionKey[];

export interface SectionIssue {
  path: string;
  message: string;
}

/** Validates a section. Drafts accept missing fields (but still reject invalid values that are present). */
export function validateSection(
  key: SectionKey,
  data: unknown,
  mode: 'draft' | 'complete',
  rules: { minimumAge?: number } = {},
) {
  const base = SECTION_SCHEMAS[key] as z.ZodObject<z.ZodRawShape>;
  const schema = mode === 'draft' ? base.partial() : base;
  // In drafts, treat empty strings as "not answered yet" so half-filled forms can be saved.
  const input =
    mode === 'draft' && data && typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data as Record<string, unknown>).filter(
            ([, v]) => v !== '' && v !== null,
          ),
        )
      : data;
  const parsed = schema.safeParse(input ?? {});
  const minimumAge = rules.minimumAge ?? DEFAULT_MINIMUM_AGE;
  const dob = parsed.success ? parsed.data['dateOfBirth'] : undefined;
  if (key === 'personal' && typeof dob === 'string' && ageOn(dob) < minimumAge)
    return {
      ok: false as const,
      issues: [
        {
          path: 'dateOfBirth',
          message: tooYoungMessage(minimumAge, ageOn(dob)),
        },
      ] as SectionIssue[],
    };
  if (
    parsed.success &&
    mode === 'complete' &&
    key === 'personal' &&
    parsed.data['country'] === 'Kenya' &&
    !parsed.data['county']
  )
    return {
      ok: false as const,
      issues: [{ path: 'county', message: 'Required' }] as SectionIssue[],
    };
  if (parsed.success)
    return { ok: true as const, data: parsed.data as Record<string, unknown> };
  return {
    ok: false as const,
    issues: parsed.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })) as SectionIssue[],
  };
}
