import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtpCode } from './entities/otp-code.entity';
import { OtpCodeRepository } from './repositories/otp-code.repository';
import { OtpService } from './otp.service';
import { OtpFacade } from './otp.facade';

@Module({
  imports: [TypeOrmModule.forFeature([OtpCode])],
  providers: [OtpCodeRepository, OtpService, OtpFacade],
  exports: [OtpFacade],
})
export class OtpModule {}
