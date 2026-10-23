import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { GridPeriod } from '../../core/timetable';

export interface Room {
  id: number;
  name: string;
  capacity: number;
  type: string;
  notes: string | null;
  isActive: boolean;
}
export interface Unavailability {
  day: number;
  from: string;
  to: string;
}
export interface Lecturer {
  id: number;
  name: string;
  email: string | null;
  department: string | null;
  maxPeriodsPerDay: number | null;
  unavailable: Unavailability[];
  isActive: boolean;
}
export interface TtClassRow {
  id: number;
  name: string;
  programmeId: number | null;
  size: number;
  isActive: boolean;
}
export interface Unit {
  id: number;
  code: string;
  name: string;
  roomType: string | null;
  isActive: boolean;
}
export interface Resources {
  rooms: Room[];
  lecturers: Lecturer[];
  classes: TtClassRow[];
  units: Unit[];
  programmes: { id: number; code: string; name: string }[];
}
export interface Term {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  days: number[];
  status: 'draft' | 'published';
  publishedAt: string | null;
  sessions?: number;
  placed?: number;
}
export interface Lesson {
  id: number;
  unitId: number;
  lecturerId: number;
  classIds: number[];
  sessionsPerWeek: number;
  length: number;
  roomType: string | null;
  effectiveRoomType: string | null;
  notes: string | null;
}
export interface Session {
  id: number;
  lessonId: number;
  day: number | null;
  startPeriodId: number | null;
  roomId: number | null;
  locked: boolean;
}
export interface Board extends Resources {
  term: Term;
  periods: GridPeriod[];
  lessons: Lesson[];
  sessions: Session[];
  issues: { sessionId: number; problems: string[] }[];
}
export interface SlotOption {
  day: number;
  periodId: number;
  roomIds: number[];
  reasons: string[];
  warnings: string[];
}
export type ResourceKind = 'rooms' | 'lecturers' | 'classes' | 'units';

/** Calls to /api/v1/admin/timetable. */
@Injectable({ providedIn: 'root' })
export class TimetableApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/timetable';

  resources = () => firstValueFrom(this.http.get<Resources>(`${this.base}/resources`));
  saveResource = (kind: ResourceKind, id: number | null, body: unknown) =>
    firstValueFrom(
      id ? this.http.put<{ id: number }>(`${this.base}/resources/${kind}/${id}`, body) : this.http.post<{ id: number }>(`${this.base}/resources/${kind}`, body),
    );

  terms = () => firstValueFrom(this.http.get<Term[]>(`${this.base}/terms`));
  createTerm = (body: unknown) => firstValueFrom(this.http.post<Term>(`${this.base}/terms`, body));
  updateTerm = (id: number, body: unknown) => firstValueFrom(this.http.put<{ term: Term; unplaced: Unplaced[] }>(`${this.base}/terms/${id}`, body));
  deleteTerm = (id: number) => firstValueFrom(this.http.delete(`${this.base}/terms/${id}`));
  savePeriods = (id: number, periods: unknown) => firstValueFrom(this.http.put<{ unplaced: Unplaced[] }>(`${this.base}/terms/${id}/periods`, { periods }));
  publish = (id: number) => firstValueFrom(this.http.post<Term>(`${this.base}/terms/${id}/publish`, {}));
  unpublish = (id: number) => firstValueFrom(this.http.post<Term>(`${this.base}/terms/${id}/unpublish`, {}));

  saveLesson = (termId: number, id: number | null, body: unknown) =>
    firstValueFrom(
      id
        ? this.http.put<{ lessonId: number; unplaced: Unplaced[] }>(`${this.base}/terms/${termId}/lessons/${id}`, body)
        : this.http.post<{ lessonId: number; unplaced: Unplaced[] }>(`${this.base}/terms/${termId}/lessons`, body),
    );
  deleteLesson = (termId: number, id: number) => firstValueFrom(this.http.delete(`${this.base}/terms/${termId}/lessons/${id}`));

  board = (termId: number) => firstValueFrom(this.http.get<Board>(`${this.base}/terms/${termId}/board`));
  options = (termId: number, sessionId: number) => firstValueFrom(this.http.get<SlotOption[]>(`${this.base}/terms/${termId}/sessions/${sessionId}/options`));
  place = (termId: number, sessionId: number, body: { day: number; periodId: number; roomId: number }) =>
    firstValueFrom(this.http.put<{ warnings: string[] }>(`${this.base}/terms/${termId}/sessions/${sessionId}/place`, body));
  unplace = (termId: number, sessionId: number) => firstValueFrom(this.http.delete(`${this.base}/terms/${termId}/sessions/${sessionId}/place`));
  lock = (termId: number, sessionId: number, locked: boolean) => firstValueFrom(this.http.put(`${this.base}/terms/${termId}/sessions/${sessionId}/lock`, { locked }));
  generate = (termId: number, rebuild: boolean) =>
    firstValueFrom(this.http.post<{ placed: number; unplaced: Unplaced[]; seconds: number }>(`${this.base}/terms/${termId}/generate`, { rebuild }));
}

export interface Unplaced {
  sessionId: number;
  reason: string;
}
