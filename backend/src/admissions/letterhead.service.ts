import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { In, type Repository } from 'typeorm';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { MediaStorage } from '../cms/media/storage.js';

export const NAVY = '#0033a0';
export const ORANGE = '#ef6d00';
export const GREY = '#5c6370';
export const INK = '#1d2027';

/** What every printed document's letterhead shows, from Site settings. */
export interface Letterhead {
  name: string;
  logo: Buffer | null;
  address: string;
  contactLine: string;
}

/**
 * The institution letterhead used on every PDF (offer letters, applications reports), so they all
 * look the same. Name, logo and contact details come from Site settings → Institution and Contact.
 */
@Injectable()
export class LetterheadService {
  private readonly logger = new Logger(LetterheadService.name);
  private readonly storage = new MediaStorage();

  constructor(
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
  ) {}

  async load(): Promise<Letterhead> {
    const rows = await this.settings.findBy({
      key: In([
        'institution.name',
        'institution.letterhead_logo_media_id',
        'institution.logo_media_id',
        'contact.address',
        'contact.phone',
        'contact.email',
        'contact.website',
      ]),
    });
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<
      string,
      unknown
    >;
    const text = (key: string) => String(s[key] ?? '').trim();
    const website = text('contact.website').replace(/^https?:\/\//, '');
    return {
      name: text('institution.name'),
      // A paper-friendly logo when one is set, otherwise the site logo.
      logo:
        (await this.image(s['institution.letterhead_logo_media_id'])) ??
        (await this.image(s['institution.logo_media_id'])),
      address: text('contact.address'),
      contactLine: [
        text('contact.phone') && `Tel: ${text('contact.phone')}`,
        text('contact.email') && `Email: ${text('contact.email')}`,
        website,
      ]
        .filter(Boolean)
        .join('   ·   '),
    };
  }

  /**
   * Draws the letterhead at the top of the current page: logo, name, address and contacts, then a
   * navy rule with an orange accent. Returns the y position just below it.
   */
  draw(
    doc: PDFKit.PDFDocument,
    lh: Letterhead,
    box: { x: number; y: number; width: number },
  ): number {
    const { x, width } = box;
    let y = box.y;
    const logoSize = 62;
    if (lh.logo) doc.image(lh.logo, x, y, { fit: [logoSize, logoSize] });
    const textX = lh.logo ? x + logoSize + 16 : x;
    const textWidth = width - (textX - x);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(NAVY)
      .text(lh.name.toUpperCase(), textX, y + 6, {
        width: textWidth,
        characterSpacing: 0.4,
      });
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
    if (lh.address)
      doc.text(lh.address, textX, doc.y + 4, { width: textWidth });
    if (lh.contactLine)
      doc.text(lh.contactLine, textX, doc.y + 2, { width: textWidth });

    y = Math.max(doc.y, lh.logo ? y + logoSize : 0) + 12;
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineWidth(1.4)
      .strokeColor(NAVY)
      .stroke();
    doc
      .moveTo(x, y + 3)
      .lineTo(x + 90, y + 3)
      .lineWidth(2.5)
      .strokeColor(ORANGE)
      .stroke();
    doc.x = x;
    return y + 14;
  }

  /** Small grey line at the bottom of every page (call after all content, with bufferPages). */
  footer(
    doc: PDFKit.PDFDocument,
    box: { x: number; width: number },
    text: (page: number, pages: number) => string,
  ) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // The footer sits inside the bottom margin; without this pdfkit would start a new page for it.
      doc.page.margins.bottom = 0;
      doc
        .moveTo(box.x, doc.page.height - 48)
        .lineTo(box.x + box.width, doc.page.height - 48)
        .lineWidth(0.5)
        .strokeColor('#d5dbe5')
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(GREY)
        .text(
          text(i - range.start + 1, range.count),
          box.x,
          doc.page.height - 40,
          { width: box.width, align: 'center', lineBreak: false },
        );
    }
  }

  /** A media library image as PNG (PDF can't embed WebP), or null. */
  private async image(mediaId: unknown): Promise<Buffer | null> {
    if (typeof mediaId !== 'number') return null;
    try {
      const m = await this.media.findOneBy({ id: mediaId });
      if (!m || !m.mimeType.startsWith('image/')) return null;
      const file = await readFile(
        resolve(this.storage.publicRoot, m.storageKey),
      );
      return await sharp(file)
        .resize({ width: 300, withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch (err) {
      this.logger.warn(
        `Letterhead logo could not be loaded: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
