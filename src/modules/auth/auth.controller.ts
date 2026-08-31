import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthProvider } from 'src/shared/enums';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './types/auth-user.type';
import { PhoneAuthService } from './services/phone-auth.service';
import { GoogleAuthService } from './services/google-auth.service';
import { TelegramAuthService } from './services/telegram-auth.service';
import { IdentityService } from './services/identity.service';
import { TokenService } from './services/token.service';
import {
  GoogleSignInDto,
  PhoneLoginDto,
  RefreshDto,
  RequestOtpDto,
  ResetPasswordDto,
  SetPasswordDto,
  TelegramPollDto,
  VerifyOtpDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly phone: PhoneAuthService,
    private readonly google: GoogleAuthService,
    private readonly telegram: TelegramAuthService,
    private readonly identities: IdentityService,
    private readonly tokens: TokenService,
  ) {}

  // ---------------------------------------------------------------- phone

  @ApiOperation({
    summary: 'Send an SMS login code',
    description: [
      'Sends a 6-digit code, valid for 5 minutes. The same endpoint covers sign-up and sign-in — whether the number is already known is not revealed.',
      '',
      'Limits: this per-IP one, plus a 60-second resend cooldown and 5 codes per hour on the number itself.',
    ].join('\n'),
  })
  @Post('phone/request')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.phone.requestOtp(dto.phone, dto.lang);
  }

  @ApiOperation({
    summary: 'Exchange an SMS code for a session',
    description: [
      'Creates the account on first use. Five wrong guesses burn the code.',
      '',
      'Passing the code proves the number belongs to the caller, so an account that already holds this number is signed into rather than duplicated.',
    ].join('\n'),
  })
  @Post('phone/verify')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.phone.verifyOtp(dto.phone, dto.code, dto.name, dto.lang);
  }

  @ApiOperation({
    summary: 'Sign in with phone + password',
    description: [
      'The returning-user path — no SMS is spent. The password is the one set after onboarding.',
      '',
      '`PASSWORD_NOT_SET` (401) means the account only knows SMS codes: fall back to `POST /auth/phone/request`. `INVALID_CREDENTIALS` deliberately does not reveal whether the account exists.',
    ].join('\n'),
  })
  @Post('phone/login')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  phoneLogin(@Body() dto: PhoneLoginDto) {
    return this.phone.loginWithPassword(dto.phone, dto.password);
  }

  @ApiOperation({
    summary: 'Set or change the password',
    description:
      'For the signed-in account. Asked right after onboarding; afterwards `POST /auth/phone/login` signs in without an SMS.',
  })
  @ApiBearerAuth('access-token')
  @Post('password')
  @UseGuards(JwtAccessGuard)
  @HttpCode(200)
  setPassword(@CurrentUser() user: AuthUser, @Body() dto: SetPasswordDto) {
    return this.phone.setPassword(user.sub, dto.password);
  }

  @ApiOperation({
    summary: 'Reset the password with an SMS code',
    description: [
      'Request a code with `POST /auth/phone/request` first. The code proves phone ownership, the password is replaced, every refresh token is revoked, and a fresh session is returned.',
      '',
      '`ACCOUNT_NOT_FOUND` (404) can only surface after a valid code, so it leaks nothing to guessers.',
    ].join('\n'),
  })
  @Post('password/reset')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.phone.resetPassword(dto.phone, dto.code, dto.password);
  }

  // ---------------------------------------------------------------- google

  @ApiOperation({
    summary: 'Sign in with Google',
    description: [
      "Send the ID token from the native Google sign-in SDK. It is verified against Google's public keys; nothing the client asserts about the account is trusted.",
      '',
      'An account with the same **Google-verified** email is signed into rather than duplicated. An unverified Google email never matches.',
    ].join('\n'),
  })
  @Post('google')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @HttpCode(200)
  googleSignIn(@Body() dto: GoogleSignInDto) {
    return this.google.signIn(dto.idToken, dto.lang);
  }

  // ---------------------------------------------------------------- telegram

  @ApiOperation({
    summary: 'Begin a Telegram login',
    description: [
      'Returns a `deepLink` to open and a `token` to poll with. The session lasts 5 minutes.',
      '',
      'Telegram vouches for neither an email nor a phone number, so this always signs into the Telegram identity itself or creates a new account — it can never merge into an existing one. Use `POST /auth/link/telegram` for that.',
    ].join('\n'),
  })
  @Post('telegram/start')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @HttpCode(200)
  telegramStart() {
    return this.telegram.startSession();
  }

  @ApiOperation({
    summary: 'Poll a Telegram login',
    description: [
      'Call every ~2s while the user is over in Telegram.',
      '',
      '`PENDING` — keep polling. `EXPIRED` — start again. `CONFIRMED` — the body also carries the session. `LINKED` — the link flow finished; no session is issued.',
      '',
      'Single-use: the call that returns `CONFIRMED` consumes the session, and polling again 401s.',
    ].join('\n'),
  })
  @Post('telegram/poll')
  @Throttle({ default: { limit: 200, ttl: 600_000 } })
  @HttpCode(200)
  telegramPoll(@Body() dto: TelegramPollDto) {
    return this.telegram.poll(dto.token);
  }

  // ---------------------------------------------------------------- session

  @ApiOperation({
    summary: 'Rotate the session',
    description: [
      'Exchanges a refresh token for a new pair. The presented token is revoked, so each one works exactly once.',
      '',
      'Replaying a spent token is treated as theft: every token in that sign-in chain is revoked and the device must sign in again.',
    ].join('\n'),
  })
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken);
  }

  @ApiOperation({
    summary: 'Log out everywhere',
    description:
      'Revokes every refresh token for the account. Access tokens already issued keep working until they expire (up to 15 minutes).',
  })
  @ApiBearerAuth('access-token')
  @Post('logout')
  @UseGuards(JwtAccessGuard)
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.tokens.revokeAllFor(user.sub);
  }

  // ---------------------------------------------------------------- linking

  @ApiOperation({
    summary: 'List the sign-in methods on this account',
    description:
      'One entry per linked provider. Useful for a settings screen — and for knowing what `DELETE /auth/link/{provider}` will refuse to remove.',
  })
  @ApiBearerAuth('access-token')
  @Get('identities')
  @UseGuards(JwtAccessGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.identities.listFor(user.sub);
  }

  @ApiOperation({
    summary: 'Link a Google account',
    description:
      'Adds Google as a way into the account you are signed in as. Conflicts (409) if that Google account already belongs to someone else.',
  })
  @ApiBearerAuth('access-token')
  @Post('link/google')
  @UseGuards(JwtAccessGuard)
  @HttpCode(200)
  linkGoogle(@CurrentUser() user: AuthUser, @Body() dto: GoogleSignInDto) {
    return this.google.link(user.sub, dto.idToken);
  }

  @ApiOperation({
    summary: 'Link a Telegram account',
    description:
      'Returns a deep link, same as `POST /auth/telegram/start`. Poll `POST /auth/telegram/poll` with the token; it resolves to `LINKED` instead of a session.',
  })
  @ApiBearerAuth('access-token')
  @Post('link/telegram')
  @UseGuards(JwtAccessGuard)
  @HttpCode(200)
  linkTelegram(@CurrentUser() user: AuthUser) {
    return this.telegram.startSession(user.sub);
  }

  @ApiOperation({
    summary: 'Unlink a sign-in method',
    description: [
      'Refuses (409 `LAST_IDENTITY`) to remove the only way into an account.',
      '',
      'Unlinking `PHONE` clears the stored phone number and `GOOGLE` the email, so the provider does not silently re-link itself on the next sign-in.',
    ].join('\n'),
  })
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'provider', enum: AuthProvider })
  @ApiOkResponse({ schema: { example: { unlinked: true } } })
  @Delete('link/:provider')
  @UseGuards(JwtAccessGuard)
  @HttpCode(200)
  unlink(
    @CurrentUser() user: AuthUser,
    @Param('provider', new ParseEnumPipe(AuthProvider)) provider: AuthProvider,
  ) {
    return this.identities.unlink(user.sub, provider);
  }
}
