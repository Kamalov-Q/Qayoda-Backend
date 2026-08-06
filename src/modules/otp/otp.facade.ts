import { Injectable } from '@nestjs/common';
import { OtpService } from './otp.service';
import { OtpPurpose } from './enums/otp-purpose.enum';
import { OtpChannel } from './enums/otp-channel.enum';

@Injectable()
export class OtpFacade {
  constructor(private readonly otpService: OtpService) {}

  requestEmailOtp(email: string, purpose: OtpPurpose, shouldSend: boolean) {
    return this.otpService.request(
      email,
      OtpChannel.EMAIL,
      purpose,
      shouldSend,
    );
  }

  verify(requestId: string, code: string) {
    return this.otpService.verify(requestId, code);
  }
}
