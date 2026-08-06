import { Injectable } from '@nestjs/common';
import { RefreshToken } from '../entities/refresh-token.entity';
import { DataSource, IsNull, Repository } from 'typeorm';

@Injectable()
export class RefreshTokenRepository extends Repository<RefreshToken> {
  constructor(private readonly dataSource: DataSource) {
    super(RefreshToken, dataSource.createEntityManager());
  }

  // `revokedAt: null` as a criteria does not mean `IS NULL` to TypeORM — it has
  // to be `IsNull()`. Getting this wrong took out theft detection and every
  // "revoke all sessions" path at once, so it is worth naming.
  revokeAllForUser(userId: string) {
    return this.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  revokeFamily(familyId: string) {
    return this.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
