import {
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { Public } from '../../identity/decorators.js';
import { normalizePath } from '../pages/page-paths.js';
import { SiteService } from '../site/site.service.js';
import { PublicService } from './public.service.js';

/** Read-only content for visitors and the server-side renderer. No sign-in needed. */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly content: PublicService,
    private readonly site: SiteService,
  ) {}

  /** Header, footer, menus, settings and interface text in one call. */
  @Get('site')
  siteData(@Query('locale') locale?: string) {
    return this.site.publicSite(
      /^[a-z]{2}$/.test(locale ?? '') ? locale! : 'en',
    );
  }

  /**
   * The published page at a path. Redirects come back as 200 with { redirect } so the
   * front end (and its server-side renderer) can issue the real 301/302 to the browser.
   */
  @Get('pages')
  async page(@Query('path') path = '/') {
    const result = await this.content.pageByPath(normalizePath(path));
    switch (result.kind) {
      case 'page':
        return result.body;
      case 'redirect':
        return { redirect: { to: result.to, statusCode: result.statusCode } };
      case 'restricted':
        throw new HttpException(
          {
            message: 'Please sign in to view this page.',
            code: 'SIGN_IN_REQUIRED',
          },
          401,
        );
      default:
        throw new NotFoundException({
          message: 'Page not found.',
          code: 'PAGE_NOT_FOUND',
        });
    }
  }

  @Get('preview/:token')
  async preview(@Param('token') token: string) {
    const result = await this.content.preview(token);
    if (!result)
      throw new NotFoundException({
        message: 'This preview link has expired or is invalid.',
        code: 'PREVIEW_EXPIRED',
      });
    return result;
  }
}
