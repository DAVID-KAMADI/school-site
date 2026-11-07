import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { MediaView } from '../../core/models';

export interface ApplicationRow {
  id: number;
  applicationNumber: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  programme: string | null;
  intake: string | null;
  status: string;
  feeStatus: string;
  meanGrade: string | null;
  meetsMinimumGrade: boolean | null;
  submittedAt: string;
}

export interface StaffDocument {
  id: number;
  documentTypeId: number;
  documentType: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'pending' | 'accepted' | 'rejected';
  reviewNote: string | null;
  reviewedBy: string | null;
  uploadedAt: string;
}

export interface StaffApplication {
  id: number;
  applicationNumber: string;
  status: string;
  allowedTransitions: string[];
  applicant: { id: number; email: string; fullName: string };
  programme: { id: number; name: string; code: string; minMeanGrade: string | null; school: string } | null;
  intake: { id: number; name: string; startsOn?: string | null } | null;
  studyMode: string | null;
  personal: Record<string, unknown> | null;
  nextOfKin: Record<string, unknown> | null;
  education: Record<string, unknown> | null;
  funding: Record<string, unknown> | null;
  meetsMinimumGrade: boolean | null;
  fee: { status: string; reference: string | null; verifiedBy: string | null; verifiedAt: string | null };
  documents: StaffDocument[];
  submittedAt: string;
  decidedAt: string | null;
  events: { id: number; type: string; fromStatus: string | null; toStatus: string | null; message: string | null; visibleToApplicant: boolean; actor: string | null; createdAt: string }[];
}

export interface ProgrammeRow {
  id: number;
  code: string;
  name: string;
  level: string;
  school: string;
  duration: string | null;
  studyModes: string[];
  minMeanGrade: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ShortCourseRow {
  id: number;
  title: string;
  category: string;
  summary: string;
  duration: string | null;
  fee: string | null;
  delivery: string;
  schedule: string | null;
  nextStartOn: string | null;
  imageId: number | null;
  image: MediaView | null;
  isActive: boolean;
  sortOrder: number;
}

export interface IntakeRow {
  id: number;
  name: string;
  opensAt: string;
  closesAt: string;
  startsOn: string | null;
  isActive: boolean;
  popupEnabled: boolean;
  popupTitle: string | null;
  popupDetails: string | null;
  popupImageId: number | null;
  popupImage: MediaView | null;
}

export interface DocumentTypeRow {
  id: number;
  name: string;
  description: string | null;
  isRequired: boolean;
  accepts: string;
  maxSizeMb: number;
  isActive: boolean;
  sortOrder: number;
}

@Injectable({ providedIn: 'root' })
export class AdmissionsAdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin';

  list(q: Record<string, string | number | undefined>) {
    const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>;
    return firstValueFrom(this.http.get<{ items: ApplicationRow[]; total: number; page: number; pageSize: number }>(`${this.base}/applications`, { params }));
  }
  /** The filtered list as a spreadsheet (csv) or a printable report on the letterhead (pdf). */
  exportUrl(q: Record<string, string | number | undefined>, format: 'csv' | 'pdf' = 'csv') {
    const params = new URLSearchParams(
      Object.entries(q)
        .filter(([k, v]) => v !== undefined && v !== '' && k !== 'page' && k !== 'pageSize')
        .map(([k, v]) => [k, String(v)]),
    );
    return `${this.base}/applications/export.${format}?${params}`;
  }
  counts = () => firstValueFrom(this.http.get<Record<string, number>>(`${this.base}/applications/counts`));
  detail = (id: number) => firstValueFrom(this.http.get<StaffApplication>(`${this.base}/applications/${id}`));
  fileUrl = (id: number, docId: number) => `${this.base}/applications/${id}/documents/${docId}/file`;
  setStatus = (id: number, status: string, message?: string) => firstValueFrom(this.http.post<StaffApplication>(`${this.base}/applications/${id}/status`, { status, message }));
  addNote = (id: number, message: string, visibleToApplicant: boolean) =>
    firstValueFrom(this.http.post<StaffApplication>(`${this.base}/applications/${id}/notes`, { message, visibleToApplicant }));
  reviewDocument = (id: number, docId: number, status: string, note?: string) =>
    firstValueFrom(this.http.patch<StaffApplication>(`${this.base}/applications/${id}/documents/${docId}`, { status, note }));
  setFee = (id: number, status: 'verified' | 'unpaid') => firstValueFrom(this.http.post<StaffApplication>(`${this.base}/applications/${id}/fee`, { status }));

  programmes = () => firstValueFrom(this.http.get<ProgrammeRow[]>(`${this.base}/admissions/programmes`));
  saveProgramme = (id: number | null, body: unknown) =>
    firstValueFrom(id ? this.http.put<ProgrammeRow>(`${this.base}/admissions/programmes/${id}`, body) : this.http.post<ProgrammeRow>(`${this.base}/admissions/programmes`, body));
  shortCourses = () => firstValueFrom(this.http.get<ShortCourseRow[]>(`${this.base}/admissions/short-courses`));
  saveShortCourse = (id: number | null, body: unknown) =>
    firstValueFrom(id ? this.http.put<ShortCourseRow>(`${this.base}/admissions/short-courses/${id}`, body) : this.http.post<ShortCourseRow>(`${this.base}/admissions/short-courses`, body));
  deleteProgramme = (id: number) => firstValueFrom(this.http.delete<void>(`${this.base}/admissions/programmes/${id}`));
  deleteIntake = (id: number) => firstValueFrom(this.http.delete<void>(`${this.base}/admissions/intakes/${id}`));
  deleteDocumentType = (id: number) => firstValueFrom(this.http.delete<void>(`${this.base}/admissions/document-types/${id}`));
  deleteShortCourse = (id: number) => firstValueFrom(this.http.delete<void>(`${this.base}/admissions/short-courses/${id}`));
  intakes = () => firstValueFrom(this.http.get<IntakeRow[]>(`${this.base}/admissions/intakes`));
  saveIntake = (id: number | null, body: unknown) =>
    firstValueFrom(id ? this.http.put<IntakeRow>(`${this.base}/admissions/intakes/${id}`, body) : this.http.post<IntakeRow>(`${this.base}/admissions/intakes`, body));
  documentTypes = () => firstValueFrom(this.http.get<DocumentTypeRow[]>(`${this.base}/admissions/document-types`));
  saveDocumentType = (id: number | null, body: unknown) =>
    firstValueFrom(id ? this.http.put<DocumentTypeRow>(`${this.base}/admissions/document-types/${id}`, body) : this.http.post<DocumentTypeRow>(`${this.base}/admissions/document-types`, body));
}
