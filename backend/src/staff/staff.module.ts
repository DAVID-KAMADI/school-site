import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module.js';
import { StaffLevel } from './entities/staff-level.entity.js';
import { StaffMember } from './entities/staff-member.entity.js';
import {
  AdminStaffController,
  PublicStaffController,
} from './staff.controller.js';
import { StaffService } from './staff.service.js';

/** The institute's staff hierarchy on the website's Our people page. */
@Module({
  imports: [TypeOrmModule.forFeature([StaffLevel, StaffMember]), CmsModule],
  controllers: [AdminStaffController, PublicStaffController],
  providers: [StaffService],
})
export class StaffModule {}
