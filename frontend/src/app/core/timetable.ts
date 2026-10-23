/** Helpers shared by the admin timetable editor and the public timetable page. */

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ROOM_TYPE_LABELS: Record<string, string> = {
  classroom: 'Classroom',
  lab: 'Laboratory',
  computer_lab: 'Computer lab',
  workshop: 'Workshop',
  hall: 'Hall',
};

export interface GridPeriod {
  id: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  label?: string | null;
}

/** A placed item to draw: where it starts and how many periods it covers. */
export interface GridItem<T> {
  day: number;
  startPeriodId: number;
  length: number;
  data: T;
}

export type GridCell<T> =
  | { kind: 'item'; day: number; rowspan: number; item: GridItem<T> }
  | { kind: 'empty'; day: number; periodId: number }
  | { kind: 'covered' };

export interface GridRow<T> {
  period: GridPeriod;
  cells: GridCell<T>[];
}

/**
 * Lays out a week as table rows (one per period) with a cell per day. A multi-period item is one cell
 * with a rowspan; the cells under it are "covered" and not drawn. Break rows have no cells.
 */
export function buildGrid<T>(periods: GridPeriod[], days: number[], items: GridItem<T>[]): GridRow<T>[] {
  const covered = new Set<string>();
  const index = new Map(periods.map((p, i) => [p.id, i]));
  return periods.map((period, row) => {
    if (period.isBreak) return { period, cells: [] };
    const cells = days.map((day): GridCell<T> => {
      if (covered.has(`${day}:${row}`)) return { kind: 'covered' };
      const item = items.find((i) => i.day === day && i.startPeriodId === period.id);
      if (!item) return { kind: 'empty', day, periodId: period.id };
      const start = index.get(item.startPeriodId)!;
      for (let r = start + 1; r < start + item.length; r++) covered.add(`${day}:${r}`);
      return { kind: 'item', day, rowspan: item.length, item };
    });
    return { period, cells };
  });
}
