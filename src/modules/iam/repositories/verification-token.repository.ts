import { Injectable } from '@nestjs/common';
import { VerificationToken } from '../entities/verification-token.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class VerificationTokenRepository extends Repository<VerificationToken> {
  constructor(private readonly dataSource: DataSource) {
    super(VerificationToken, dataSource.createEntityManager());
  }
}
