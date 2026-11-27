/** Rows → CSV text for Excel: a BOM so accents show correctly, quoted cells, and no formula injection. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '﻿No data\r\n';
  const columns = Object.keys(rows[0]).filter((k) => {
    const v = rows[0][k];
    return v === null || typeof v !== 'object' || v instanceof Date;
  });
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    // A cell starting with = + - @ would run as a formula in Excel.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.replace(/([A-Z])/g, ' $1').toLowerCase())).join(',');
  return `﻿${head}\r\n${rows.map((r) => columns.map((c) => cell(r[c])).join(',')).join('\r\n')}\r\n`;
}
