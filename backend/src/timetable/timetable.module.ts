import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Programme } from '../admissions/entities/programme.entity.js';
import {
  TtClass,
  TtLecturer,
  TtRoom,
  TtUnit,
} from './entities/resources.entity.js';
import {
  TtLesson,
  TtPeriod,
  TtSession,
  TtSlot,
  TtTerm,
} from './entities/term.entity.js';
import {
  PublicTimetableController,
  TimetableController,
} from './timetable.controller.js';
import { TimetableService } from './timetable.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TtRoom,
      TtLecturer,
      TtClass,
      TtUnit,
      TtTerm,
      TtPeriod,
      TtLesson,
      TtSession,
      TtSlot,
      Programme,
    ]),
  ],
  controllers: [TimetableController, PublicTimetableController],
  providers: [TimetableService],
})
export class TimetableModule {}
