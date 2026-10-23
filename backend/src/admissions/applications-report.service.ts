import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import type { Repository } from 'typeorm';
import type { Application } from './entities/application.entity.js';
import { Intake } from './entities/intake.entity.js';
import { Programme } from './entities/programme.entity.js';
import { GREY, INK, LetterheadService, NAVY } from './letterhead.service.js';

const STATUS: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  info_requested: 'Info requested',
  offered: 'Offered',
  accepted: 'Accepted',
  declined: 'Declined',
  rejected: 'Not successful',
  withdrawn: 'Withdrawn',
};
const FEE: Record<string, string> = {
  unpaid: 'Not paid',
  claimed: 'Reported',
  verified: 'Paid',
};

export interface ReportFilters {
  status?: string;
  programmeId?: number;
  intakeId?: number;
  fee?: string;
  search?: string;
}

/** Column layout of the applications table (landscape A4, 742pt between the margins). */
const COLUMNS: { title: string; width: number }[] = [
  { title: '#', width: 24 },
  { title: 'Application no.', width: 84 },
  { title: 'Applicant', width: 158 },
  { title: 'Programme', width: 160 },
  { title: 'Intake', width: 80 },
  { title: 'Status', width: 70 },
  { title: 'Fee', width: 52 },
  { title: 'Grade', width: 40 },
  { title: 'Submitted', width: 74 },
];

/**
 * The applications list as a printable PDF on the institution letterhead: the same rows and
 * filters as the CSV export, with a summary by status.
 */
@Injectable()
export class ApplicationsReportService {
  constructor(
    private readonly letterhead: LetterheadService,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(Intake) private readonly intakes: Repository<Intake>,
  ) {}

  async render(rows: Application[], filters: ReportFilters): Promise<Buffer> {
    const lh = await this.letterhead.load();
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
      margins: { top: 40, bottom: 60, left: 50, right: 50 },
      info: { Title: 'Applications report', Author: lh.name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) =>
      doc.on('end', () => res(Buffer.concat(chunks))),
    );
    const x = 50;
    const width = doc.page.width - 100;
    const generated = new Date().toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Nairobi',
    });

    let y = this.letterhead.draw(doc, lh, { x, y: 36, width });

    // Title, filters and summary
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(NAVY)
      .text('Applications report', x, y);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(GREY)
      .text(
        `${await this.describe(filters)}   ·   ${rows.length} application${rows.length === 1 ? '' : 's'}   ·   Generated ${generated} (EAT)`,
        x,
        doc.y + 3,
        { width },
      );
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (rows.length) {
      y = doc.y + 8;
      let cx = x;
      for (const [status, label] of Object.entries(STATUS)) {
        const n = counts.get(status);
        if (!n) continue;
        const text = `${label}: ${n}`;
        doc.font('Helvetica-Bold').fontSize(8.5);
        const w = doc.widthOfString(text) + 16;
        if (cx + w > x + width) {
          cx = x;
          y += 20;
        }
        doc.roundedRect(cx, y, w, 16, 8).fillColor('#e9f0fd').fill();
        doc.fillColor(NAVY).text(text, cx + 8, y + 4, { lineBreak: false });
        cx += w + 6;
      }
      doc.y = y + 16;
    }

    // Table
    y = doc.y + 12;
    y = this.header(doc, x, y);
    if (!rows.length) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(GREY)
        .text('No applications match these filters.', x, y + 10, { width });
    }
    const bottom = doc.page.height - 66;
    rows.forEach((a, i) => {
      const cells = [
        String(i + 1),
        a.applicationNumber ?? '',
        `${a.fullName ?? ''}\n${[a.applicant?.email, a.phone].filter(Boolean).join(' · ')}`,
        a.programme?.name ?? '',
        a.intake?.name ?? '',
        STATUS[a.status] ?? a.status,
        FEE[a.feeStatus] ?? a.feeStatus,
        a.meanGrade ?? '',
        a.submittedAt
          ? a.submittedAt.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'Africa/Nairobi',
            })
          : '',
      ];
      doc.font('Helvetica').fontSize(8.5);
      const height =
        Math.max(
          ...cells.map((c, ci) =>
            doc.heightOfString(c, { width: COLUMNS[ci].width - 10 }),
          ),
        ) + 10;
      if (y + height > bottom) {
        doc.addPage();
        y = this.header(doc, x, 40);
      }
      if (i % 2 === 1)
        doc.rect(x, y, width, height).fillColor('#f5f7fb').fill();
      let cx = x;
      cells.forEach((c, ci) => {
        const col = COLUMNS[ci];
        if (ci === 2) {
          // Name in bold, contacts below in grey.
          const [name, contact] = c.split('\n');
          doc
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .fillColor(INK)
            .text(name, cx + 5, y + 5, { width: col.width - 10 });
          if (contact)
            doc
              .font('Helvetica')
              .fontSize(7.5)
              .fillColor(GREY)
              .text(contact, cx + 5, doc.y + 1, { width: col.width - 10 });
        } else {
          doc
            .font(ci === 1 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(8.5)
            .fillColor(ci === 0 ? GREY : INK)
            .text(c, cx + 5, y + 5, { width: col.width - 10 });
        }
        cx += col.width;
      });
      y += height;
      doc
        .moveTo(x, y)
        .lineTo(x + width, y)
        .lineWidth(0.4)
        .strokeColor('#e3e7ef')
        .stroke();
    });

    this.letterhead.footer(
      doc,
      { x, width },
      (page, pages) =>
        `${lh.name} · Applications report · Generated ${generated} · Page ${page} of ${pages} · Confidential: contains applicants' personal data`,
    );
    doc.end();
    return done;
  }

  /** The navy column header row; returns the y below it. */
  private header(doc: PDFKit.PDFDocument, x: number, y: number): number {
    const width = COLUMNS.reduce((n, c) => n + c.width, 0);
    doc.rect(x, y, width, 20).fillColor(NAVY).fill();
    let cx = x;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    for (const col of COLUMNS) {
      doc.text(col.title, cx + 5, y + 6, {
        width: col.width - 10,
        lineBreak: false,
      });
      cx += col.width;
    }
    return y + 20;
  }

  /** "Status: Offered · Programme: Diploma in Nursing" — or "All submitted applications". */
  private async describe(f: ReportFilters): Promise<string> {
    const parts: string[] = [];
    if (f.status) parts.push(`Status: ${STATUS[f.status] ?? f.status}`);
    if (f.programmeId) {
      const p = await this.programmes.findOneBy({ id: f.programmeId });
      parts.push(`Programme: ${p?.name ?? f.programmeId}`);
    }
    if (f.intakeId) {
      const i = await this.intakes.findOneBy({ id: f.intakeId });
      parts.push(`Intake: ${i?.name ?? f.intakeId}`);
    }
    if (f.fee) parts.push(`Fee: ${FEE[f.fee] ?? f.fee}`);
    if (f.search) parts.push(`Search: “${f.search}”`);
    return parts.length ? parts.join('  ·  ') : 'All submitted applications';
  }
}
