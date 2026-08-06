import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { OtpCodeRepository } from './repositories/otp-code.repository';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { DataSource, IsNull } from 'typeorm';
import { OtpChannel } from './enums/otp-channel.enum';
import { OtpPurpose } from './enums/otp-purpose.enum';
import * as bcrypt from 'bcrypt';
import { OtpCode } from './entities/otp-code.entity';

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly otpCodes: OtpCodeRepository,
    private readonly outbox: OutBoxService,
    private readonly dataSource: DataSource,
  ) {}

  async request(
    subject: string,
    channel: OtpChannel,
    purpose: OtpPurpose,
    shouldSend: boolean,
  ) {
    const code = randomInt(100000, 999999).toString();
    const codeHash = await bcrypt.hash(code, 10);

    const expiresAt = new Date(Date.now() + TTL_MS);

    const requestId = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OtpCode);
      const otp = await repo.save(
        repo.create({
          subject,
          channel,
          purpose,
          codeHash,
          expiresAt,
          attempts: 0,
        }),
      );

      if (shouldSend) {
        await this.outbox.publish(
          'otp.requested',
          { requestId: otp.id, subject, channel, purpose, code },
          manager,
        );
      }
      return otp.id;
    });

    return { requestId, expiresAt: TTL_MS / 1000 };
  }

  async verify(
    requestId: string,
    code: string,
  ): Promise<{ subject: string; purpose: OtpPurpose }> {
    const otp = await this.otpCodes.findOneBy({ id: requestId });
    if (!otp || otp.consumedAt)
      throw new BadRequestException('Invalid or expired code');
    if (otp.expiresAt < new Date())
      throw new BadRequestException('Code expired');
    if (otp.attempts >= MAX_ATTEMPTS)
      throw new BadRequestException('Too many attempts, request a new code');

    if (!(await bcrypt.compare(code, otp.codeHash))) {
      await this.otpCodes.increment({ id: requestId }, 'attempts', 1);
      throw new BadRequestException('Invalid code');
    }

    const claimed = await this.otpCodes.update(
      { id: requestId, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    if (claimed.affected !== 1)
      throw new BadRequestException('Invalid or expired code');

    return { subject: otp.subject, purpose: otp.purpose };
  }
}
