import { Module } from '@nestjs/common';
import { WellbeingController } from './wellbeing.controller';
import { WellbeingService } from './wellbeing.service';
import { WellbeingAppointmentPrismaRepository } from './data/wellbeing.repository';
import { WELLBEING_APPOINTMENT_REPOSITORY } from './domain/wellbeing.domain';

/**
 * 心理治疗模块（契约 §9 最高敏感）。
 * ConsentService / AuditService 来自全局 ComplianceModule，无需 import。
 */
@Module({
  controllers: [WellbeingController],
  providers: [
    WellbeingService,
    {
      provide: WELLBEING_APPOINTMENT_REPOSITORY,
      useClass: WellbeingAppointmentPrismaRepository,
    },
  ],
  exports: [WellbeingService],
})
export class WellbeingModule {}
