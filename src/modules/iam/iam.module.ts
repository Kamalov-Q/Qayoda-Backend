import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationToken } from './entities/verification-token.entity';
import { OtpModule } from '../otp/otp.module';
import { IamController } from './iam.controller';
import { IamService } from './iam.service';
import { IamFacade } from './iam.facade';
import { TokenService } from './token.service';
import { UserRepository } from './repositories/user.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, VerificationToken]),
    OtpModule,
  ],
  controllers: [IamController],
  providers: [
    IamService,
    IamFacade,
    TokenService,
    UserRepository,
    RefreshTokenRepository,
    VerificationTokenRepository,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    JwtService,
  ],
  // IamService leaves the module for exactly one consumer: ProfileController
  // lives in MediaModule (it needs MediaFacade for avatar processing) but its
  // data operations are IAM's.
  exports: [IamFacade, IamService],
})
export class IamModule {}
