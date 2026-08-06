import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OtpCode } from '../entities/otp-code.entity';

@Injectable()
export class OtpCodeRepository extends Repository<OtpCode> {
  constructor(private readonly dataSource: DataSource) {
    super(OtpCode, dataSource.createEntityManager());
  }
}
