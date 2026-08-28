import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { NotificationsModule } from '../notifications/notifications.module';

import { IdentityService } from './services/identity.service';
import { PhoneAuthService } from './services/phone-auth.service';
import { GoogleAuthService } from './services/google-auth.service';
import { TelegramAuthService } from './services/telegram-auth.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { OptionalJwtGuard } from './guards/optional-jwt.guard';
import { AuthController } from './auth.controller';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { AuthIdentity } from './entities/auth-identity.entity';
import { PhoneOtpCode } from './entities/phone-otp-code.entity';
import { TelegramSession } from './entities/telegram-session.entity';
import { RefreshToken } from './entities/refresh-token.entity';

/**
 * Everything that decides *who* a request is. Three ways in — an SMS code, a
 * Google ID token, a Telegram deep link — all converging on IdentityService,
 * which is the only place a provider account is turned into a user.
 *
 * What a user *is* (name, avatar, presence) lives in UsersModule; this module
 * only reads the User entity to mint tokens from it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthIdentity,
      PhoneOtpCode,
      TelegramSession,
      RefreshToken,
    ]),
    // Secrets are passed per sign/verify call, so there is nothing to register.
    JwtModule.register({}),
    HttpModule.register({ timeout: 10_000 }),
    PassportModule,
    NotificationsModule,
  ],
  controllers: [AuthController, TelegramWebhookController],
  providers: [
    IdentityService,
    PhoneAuthService,
    GoogleAuthService,
    TelegramAuthService,
    TokenService,
    JwtStrategy,
    JwtAccessGuard,
    OptionalJwtGuard,
  ],
  exports: [TokenService, IdentityService, JwtAccessGuard, OptionalJwtGuard],
})
export class AuthModule {}
