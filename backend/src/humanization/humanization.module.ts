import { Module } from '@nestjs/common';
import { HumanizationService } from './humanization.service';
import { PresenceSchedulerService } from './presence.scheduler';
import { PrismaService } from '../prisma.service';
import { MessageSendingModule } from '../message-sending/message-sending.module';

@Module({
  imports: [MessageSendingModule],
  providers: [HumanizationService, PresenceSchedulerService, PrismaService],
  exports: [HumanizationService],
})
export class HumanizationModule { }

