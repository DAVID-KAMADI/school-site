import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { In, type Repository } from 'typeorm';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import type { Application } from './entities/application.entity.js';
import { GREY, LetterheadService, NAVY } from './letterhead.service.js';

export interface OfferLetterSettings {
  title: string;
  body: string;
  joining_instructions: string;
  signatory_name: string;
  signatory_title: string;
}

const STUDY_MODES: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  evening: 'Evening',
  weekend: 'Weekend',
};

/** Fills {placeholders}; unknown ones are left as they are so editors notice typos. */
export function fillTemplate(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

/** The date by which an offer must be accepted. */
export function acceptBy(decidedAt: Date, days: number): Date {
  const d = new Date(decidedAt);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d;
}

/**
 * Builds the admission offer letter as a PDF. Every word comes from Site settings
 * (Admissions → Offer letter), so admissions staff can change the letter without a developer.
 */
@Injectable()
export class OfferLetterService {
  constructor(
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly letterhead: LetterheadService,
  ) {}

  async render(app: Application): Promise<Buffer> {
    const rows = await this.settings.findBy({
      key: In([
        'admissions.offer_letter',
        'admissions.offer_acceptance_days',
        'portal.student_url',
      ]),
    });
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<
      string,
      unknown
    >;
    const letter = (s['admissions.offer_letter'] ??
      {}) as Partial<OfferLetterSettings>;
    const days = Number(s['admissions.offer_acceptance_days'] ?? 14);
    const lh = await this.letterhead.load();
    const institution = lh.name;
    const personal = (app.personal ?? {}) as Record<string, string>;
    const name =
      [personal['firstName'], personal['middleName'], personal['lastName']]
        .filter(Boolean)
        .join(' ') ||
      app.fullName ||
      '';
    const decided = app.decidedAt ?? new Date();
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Nairobi',
      });
    const reporting = app.intake?.startsOn
      ? fmt(new Date(`${app.intake.startsOn}T00:00:00+03:00`))
      : 'to be communicated';

    const values: Record<string, string> = {
      applicant_name: name,
      first_name: personal['firstName'] ?? name,
      application_number: app.applicationNumber ?? '',
      programme: app.programme?.name ?? '',
      programme_code: app.programme?.code ?? '',
      school: app.programme?.school ?? '',
      duration: app.programme?.duration ?? '',
      study_mode: STUDY_MODES[app.studyMode ?? ''] ?? '',
      intake: app.intake?.name ?? '',
      reporting_date: reporting,
      accept_by: fmt(acceptBy(decided, days)),
      institution_name: institution,
      // When no portal address is set yet, point applicants to their application account instead.
      student_portal:
        String(s['portal.student_url'] ?? '') ||
        'see your application account for the link',
    };

    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      margins: { top: 50, bottom: 60, left: 60, right: 60 },
      info: {
        Title: `Offer of admission ${values['application_number']}`,
        Author: institution,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((res) =>
      doc.on('end', () => res(Buffer.concat(chunks))),
    );
    const width = doc.page.width - 120;

    // Letterhead: the same on every document (see LetterheadService).
    const y = this.letterhead.draw(doc, lh, { x: 60, y: 46, width });

    // Reference block
    doc.fillColor('#1d2027').fontSize(10).font('Helvetica');
    doc.text(`Date: ${fmt(decided)}`, 60, y + 4);
    doc.text(`Our ref: ${values['application_number']}`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text(name);
    if (personal['address'])
      doc.font('Helvetica').text(personal['address'], { width: width / 2 });

    // Title
    doc.moveDown(1.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(NAVY)
      .text(
        fillTemplate(
          letter.title ?? 'Offer of admission',
          values,
        ).toUpperCase(),
        { width },
      );
    doc.moveDown(0.6);

    // Body
    doc.font('Helvetica').fontSize(10.5).fillColor('#1d2027');
    for (const para of fillTemplate(letter.body ?? '', values).split(
      /\n\s*\n/,
    )) {
      doc.text(para.trim(), { width, align: 'justify', lineGap: 2 });
      doc.moveDown(0.6);
    }

    // Summary box
    const details: [string, string][] = [
      [
        'Programme',
        `${values['programme']}${values['programme_code'] ? ` (${values['programme_code']})` : ''}`,
      ],
      ['Course area', values['school']],
      ['Study mode', values['study_mode']],
      ['Intake', values['intake']],
      ['Reporting date', values['reporting_date']],
      ['Accept this offer by', values['accept_by']],
    ];
    const boxTop = doc.y + 4;
    const rowH = 18;
    doc
      .rect(60, boxTop, width, details.length * rowH + 14)
      .fillColor('#f3f6fb')
      .fill();
    doc
      .rect(60, boxTop, 4, details.length * rowH + 14)
      .fillColor(NAVY)
      .fill();
    details.forEach(([k, v], i) => {
      const ry = boxTop + 9 + i * rowH;
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(GREY)
        .text(k, 76, ry, { width: 140 });
      doc
        .font('Helvetica-Bold')
        .fillColor('#1d2027')
        .text(v || '—', 220, ry, { width: width - 165 });
    });
    doc.y = boxTop + details.length * rowH + 28;
    doc.x = 60;

    // Joining instructions
    const instructions = fillTemplate(
      letter.joining_instructions ?? '',
      values,
    ).trim();
    if (instructions) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fontSize(11.5)
        .fillColor(NAVY)
        .text('Joining instructions', 60, doc.y, { width });
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10).fillColor('#1d2027');
      for (const line of instructions
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)) {
        const bullet = /^[-*•]\s*/.test(line);
        doc.text(
          bullet ? `•  ${line.replace(/^[-*•]\s*/, '')}` : line,
          bullet ? 70 : 60,
          doc.y,
          { width: width - (bullet ? 10 : 0), lineGap: 1.5 },
        );
        doc.moveDown(0.25);
      }
    }

    // Signature
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.moveDown(1.5);
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor('#1d2027')
      .text('Yours sincerely,', 60, doc.y);
    doc.moveDown(2.2);
    doc
      .moveTo(60, doc.y)
      .lineTo(230, doc.y)
      .lineWidth(0.7)
      .strokeColor('#9aa3af')
      .stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(letter.signatory_name || '');
    doc
      .font('Helvetica')
      .fillColor(GREY)
      .text(letter.signatory_title || '');

    // Footer on every page
    this.letterhead.footer(
      doc,
      { x: 60, width },
      (page, pages) =>
        `${institution} · ${values['application_number']} · Page ${page} of ${pages} · Verify this letter with the admissions office`,
    );
    doc.end();
    return done;
  }
}
