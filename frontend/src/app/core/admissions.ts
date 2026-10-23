import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Shared labels and API client for the admissions system (applicant portal and admin). */

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  info_requested: 'More information needed',
  offered: 'Offered a place',
  rejected: 'Not successful',
  withdrawn: 'Withdrawn',
  accepted: 'Accepted place',
  declined: 'Declined offer',
};

export const STUDY_MODE_LABELS: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  evening: 'Evening',
  weekend: 'Weekend',
};

export const DELIVERY_LABELS: Record<string, string> = {
  in_person: 'In person',
  online: 'Online',
  blended: 'Blended',
};

export const LEVEL_LABELS: Record<string, string> = {
  certificate: 'Certificate',
  diploma: 'Diploma',
  degree: 'Degree',
  postgraduate: 'Postgraduate',
  short_course: 'Short course',
};

export const FUNDING_LABELS: Record<string, string> = {
  self: 'Myself',
  parent_guardian: 'Parent or guardian',
  helb: 'HELB loan',
  bursary: 'Bursary (e.g. county or CDF)',
  sponsor: 'Sponsor or employer',
  scholarship: 'Scholarship',
};

export const GENDER_LABELS: Record<string, string> = { female: 'Female', male: 'Male', prefer_not_to_say: 'Prefer not to say' };

export const ID_TYPE_LABELS: Record<string, string> = {
  national_id: 'National ID',
  birth_certificate: 'Birth certificate',
  passport: 'Passport',
  alien_id: 'Alien ID',
};

export const FEE_LABELS: Record<string, string> = { unpaid: 'Not paid', claimed: 'Payment reported', verified: 'Paid' };

export const KCSE_GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E'];

export const KCSE_SUBJECTS = [
  'English', 'Kiswahili', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'General Science', 'History & Government',
  'Geography', 'CRE', 'IRE', 'HRE', 'Home Science', 'Art & Design', 'Agriculture', 'Computer Studies', 'Business Studies',
  'French', 'German', 'Arabic', 'Music', 'Woodwork', 'Metalwork', 'Building Construction', 'Power Mechanics', 'Electricity',
  'Drawing & Design', 'Aviation Technology', 'Kenya Sign Language',
];

export const COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega',
  'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni',
  'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua',
  'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga',
  'Wajir', 'West Pokot', 'Outside Kenya',
];

/** RCMRD's 20 contracting member states: listed first in the country list. Keep in sync with the API's application-schemas.ts. */
export const RCMRD_MEMBER_STATES = [
  'Botswana', 'Burundi', 'Comoros', 'Eswatini', 'Ethiopia', 'Kenya', 'Lesotho', 'Malawi', 'Mauritius', 'Namibia', 'Rwanda',
  'Seychelles', 'Somalia', 'South Africa', 'South Sudan', 'Sudan', 'Tanzania', 'Uganda', 'Zambia', 'Zimbabwe',
];

export const OTHER_COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Cabo Verde', 'Cambodia', 'Cameroon',
  'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Costa Rica', "Côte d'Ivoire", 'Croatia', 'Cuba',
  'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
  'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia',
  'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
  'Luxembourg', 'Madagascar', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mexico',
  'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Republic of the Congo', 'Romania', 'Russia', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'South Korea', 'Spain', 'Sri Lanka', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Tajikistan', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen',
];

export interface ProgrammeOption {
  id: number;
  code: string;
  name: string;
  level: string;
  school: string;
  duration: string | null;
  studyModes: string[];
  minMeanGrade: string | null;
  description: string | null;
}

export interface FeeInfo {
  amount: number;
  currency: string;
  instructions: string;
}

export interface AdmissionsOptions {
  programmes: ProgrammeOption[];
  intakes: { id: number; name: string; closesAt: string; startsOn: string | null }[];
  documentTypes: { id: number; name: string; description: string | null; isRequired: boolean; accepts: string; maxSizeMb: number }[];
  settings: Record<string, unknown>;
}

export interface AppDocument {
  id: number;
  documentTypeId: number;
  documentType: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'pending' | 'accepted' | 'rejected';
  reviewNote: string | null;
  uploadedAt: string;
}

export interface ApplicantApplication {
  id: number;
  applicationNumber: string | null;
  status: string;
  editable: boolean;
  sections: Record<string, Record<string, unknown> | null>;
  programme: { id: number; name: string; code: string; minMeanGrade: string | null } | null;
  intake: { id: number; name: string; closesAt: string } | null;
  meetsMinimumGrade: boolean | null;
  completion: { sections: Record<string, boolean>; missingDocuments: { id: number; name: string }[]; ready: boolean };
  documents: AppDocument[];
  fee: FeeInfo & { status: string; reference: string | null };
  submittedAt: string | null;
  decidedAt: string | null;
  offer: { acceptBy: string | null; canRespond: boolean; respondedAt: string | null; letterAvailable: boolean } | null;
  studentPortalUrl: string | null;
  messages: { id: number; type: string; toStatus: string | null; message: string | null; createdAt: string }[];
}

@Injectable({ providedIn: 'root' })
export class ApplicantApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/applicant';

  options = () => firstValueFrom(this.http.get<AdmissionsOptions>(`${this.base}/options`));
  register = (body: { fullName: string; email: string; phone: string; password: string; acceptTerms: boolean }) => firstValueFrom(this.http.post(`${this.base}/register`, body));
  application = () => firstValueFrom(this.http.get<ApplicantApplication>(`${this.base}/application`));
  saveSection = (key: string, data: unknown) => firstValueFrom(this.http.put<ApplicantApplication>(`${this.base}/application/sections/${key}`, { data }));
  upload(documentTypeId: number, file: File) {
    const form = new FormData();
    form.append('documentTypeId', String(documentTypeId));
    form.append('file', file);
    return firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/documents`, form));
  }
  deleteDocument = (id: number) => firstValueFrom(this.http.delete<ApplicantApplication>(`${this.base}/application/documents/${id}`));
  documentUrl = (id: number) => `${this.base}/application/documents/${id}/file`;
  submit = () => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/submit`, { declaration: true }));
  reportFee = (reference: string) => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/fee`, { reference }));
  message = (message: string) => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/messages`, { message }));
  withdraw = () => firstValueFrom(this.http.post(`${this.base}/application/withdraw`, {}));
  acceptOffer = () => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/offer/accept`, {}));
  declineOffer = () => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/offer/decline`, {}));
  offerLetterUrl = () => `${this.base}/application/offer-letter.pdf`;
  startNew = () => firstValueFrom(this.http.post<ApplicantApplication>(`${this.base}/application/new`, {}));
}

export function formatMoney(fee: Pick<FeeInfo, 'amount' | 'currency'> | null | undefined): string {
  if (!fee) return '';
  return `${fee.currency} ${Number(fee.amount).toLocaleString('en-KE')}`;
}
