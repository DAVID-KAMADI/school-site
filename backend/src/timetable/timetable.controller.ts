import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { AuthUser } from '../identity/auth-user.js';
import {
  CurrentUser,
  Public,
  RequirePermissions,
} from '../identity/decorators.js';
import { TermStatus } from './entities/term.entity.js';
import { TimetableService } from './timetable.service.js';

/** Timetable management: shared rooms, lecturers, classes and units, and each term's timetable. */
@Controller('admin/timetable')
@RequirePermissions('admin.access', 'timetable.manage')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  // ---------- Shared resources

  @Get('resources')
  resources() {
    return this.timetable.resources();
  }

  @Post('resources/:kind')
  create(
    @Param('kind') kind: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.saveResource(kind, null, body, user);
  }

  @Put('resources/:kind/:id')
  update(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.saveResource(kind, id, body, user);
  }

  // ---------- Terms

  @Get('terms')
  terms() {
    return this.timetable.listTerms();
  }

  @Post('terms')
  createTerm(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.timetable.createTerm(body, user.id);
  }

  @Put('terms/:id')
  updateTerm(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.updateTerm(id, body, user.id);
  }

  @Delete('terms/:id')
  async deleteTerm(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.timetable.deleteTerm(id, user.id);
    return { ok: true };
  }

  @Put('terms/:id/periods')
  periods(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { periods: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.savePeriods(id, body?.periods, user.id);
  }

  @Post('terms/:id/publish')
  @HttpCode(200)
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.setStatus(id, TermStatus.Published, user.id);
  }

  @Post('terms/:id/unpublish')
  @HttpCode(200)
  unpublish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.setStatus(id, TermStatus.Draft, user.id);
  }

  // ---------- Lessons

  @Post('terms/:id/lessons')
  createLesson(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.saveLesson(id, null, body, user.id);
  }

  @Put('terms/:id/lessons/:lessonId')
  updateLesson(
    @Param('id', ParseIntPipe) id: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.saveLesson(id, lessonId, body, user.id);
  }

  @Delete('terms/:id/lessons/:lessonId')
  async deleteLesson(
    @Param('id', ParseIntPipe) id: number,
    @Param('lessonId', ParseIntPipe) lessonId: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.timetable.deleteLesson(id, lessonId, user.id);
    return { ok: true };
  }

  // ---------- The timetable

  @Get('terms/:id/board')
  board(@Param('id', ParseIntPipe) id: number) {
    return this.timetable.board(id);
  }

  @Get('terms/:id/sessions/:sessionId/options')
  options(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
  ) {
    return this.timetable.options(id, sessionId);
  }

  @Put('terms/:id/sessions/:sessionId/place')
  place(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.place(id, sessionId, body, user.id);
  }

  @Delete('terms/:id/sessions/:sessionId/place')
  async unplace(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.timetable.unplace(id, sessionId, user.id);
    return { ok: true };
  }

  @Put('terms/:id/sessions/:sessionId/lock')
  async lock(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() body: { locked?: unknown },
  ) {
    await this.timetable.lock(id, sessionId, body?.locked === true);
    return { ok: true };
  }

  @Post('terms/:id/generate')
  @HttpCode(200)
  generate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rebuild?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetable.generate(id, body?.rebuild === true, user.id);
  }

  private saveResource(
    kind: string,
    id: number | null,
    body: unknown,
    user: AuthUser,
  ) {
    switch (kind) {
      case 'rooms':
        return this.timetable.saveRoom(id, body, user.id);
      case 'lecturers':
        return this.timetable.saveLecturer(id, body, user.id);
      case 'classes':
        return this.timetable.saveClass(id, body, user.id);
      case 'units':
        return this.timetable.saveUnit(id, body, user.id);
      default:
        throw new NotFoundException();
    }
  }
}

/** Published timetables for the public /timetable page. */
@Public()
@Controller('public/timetable')
export class PublicTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  terms() {
    return this.timetable.publicTerms();
  }

  @Get(':id')
  term(@Param('id', ParseIntPipe) id: number) {
    return this.timetable.publicTimetable(id);
  }
}
