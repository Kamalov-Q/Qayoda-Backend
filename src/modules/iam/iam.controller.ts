import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IamService } from './iam.service';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import {
  LOGIN_THROTTLE,
  OTP_REQUEST_THROTTLE,
  OTP_VERIFY_THROTTLE,
  REFRESH_THROTTLE,
} from 'src/shared/security/throttler.config';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LoginOtpDto } from './dto/login-otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CurrentUser } from './guards/current-user.decorator';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OtpRequestResponse } from './responses/otp-request.response';
import { OtpVerifyResponse } from './responses/otp-verify.response';
import { SessionResponse } from './responses/session.response';
import { UserResponse } from './responses/user.response';
import { SuccessMessageResponse } from './responses/success-message.response';
import { ErrorResponse } from './responses/error.response';

const THROTTLED = {
  type: ErrorResponse,
  description: 'Rate limit for this endpoint exceeded.',
};

const BAD_BODY = {
  type: ErrorResponse,
  description: 'Request body failed validation.',
};

@ApiTags('Auth')
@ApiTooManyRequestsResponse(THROTTLED)
@Controller('auth')
export class IamController {
  constructor(private readonly iamService: IamService) {}

  @ApiOperation({
    summary: 'Request a one-time code',
    description: [
      'Sends a 6-digit code to the email address and returns the `requestId` needed to verify it.',
      '',
      'The response is deliberately identical whether or not an account exists — a code is only actually delivered when the purpose fits the account state (`REGISTER` for unknown addresses, `LOGIN` and `RESET_PASSWORD` for known ones, `CHANGE_EMAIL` always). Do not use this endpoint to probe whether an address is registered.',
      '',
      'Rate limit: 3 requests per minute.',
    ].join('\n'),
  })
  @ApiCreatedResponse({
    type: OtpRequestResponse,
    description:
      'Code request accepted. Returned even when no code was delivered.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @Throttle({ default: OTP_REQUEST_THROTTLE })
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.iamService.requestOtp(dto.email, dto.purpose);
  }

  @ApiOperation({
    summary: 'Verify a one-time code',
    description: [
      'Exchanges a valid code for a short-lived, single-use verification token that authorises the next step (register, OTP login, or password reset).',
      '',
      'The code is consumed on success. Five failed attempts burn the request and a new code must be requested.',
      '',
      'Rate limit: 10 requests per minute.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: OtpVerifyResponse,
    description: 'Code accepted; verification token issued for 15 minutes.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'Code is wrong, expired, already used, or the attempt limit was reached.',
  })
  @Throttle({ default: OTP_VERIFY_THROTTLE })
  @HttpCode(HttpStatus.OK)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.iamService.verifyOtp(dto.requestId, dto.code);
  }

  @ApiOperation({
    summary: 'Create an account',
    description: [
      'Completes sign-up using a verification token issued for the `REGISTER` purpose, and logs the new user straight in.',
      '',
      'The email comes from the verification token, so it cannot be changed here.',
    ].join('\n'),
  })
  @ApiCreatedResponse({
    type: SessionResponse,
    description: 'Account created and a session issued.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Verification token is invalid, expired, already used, or was issued for a different purpose.',
  })
  @ApiConflictResponse({
    type: ErrorResponse,
    description: 'An account already exists for this email.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.iamService.register(
      dto.verificationToken,
      dto.name,
      dto.surname,
      dto.password,
    );
  }

  @ApiOperation({
    summary: 'Log in with email and password',
    description: [
      'Returns a fresh access/refresh token pair.',
      '',
      'Unknown email and wrong password are reported identically. Accounts with no password set (OTP-only sign-ups) always fail here — use `POST /auth/login/otp`.',
      '',
      'Rate limit: 5 requests per minute.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: SessionResponse, description: 'Session issued.' })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description: 'Invalid credentials.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @Throttle({ default: LOGIN_THROTTLE })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.iamService.loginWithPassword(dto.email, dto.password);
  }

  @ApiOperation({
    summary: 'Log in with a one-time code',
    description: [
      'Passwordless sign-in. Exchanges a verification token issued for the `LOGIN` purpose for a session.',
      '',
      'Rate limit: 5 requests per minute.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: SessionResponse, description: 'Session issued.' })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Verification token is invalid, expired, already used, issued for a different purpose, or the account no longer exists.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @Throttle({ default: LOGIN_THROTTLE })
  @HttpCode(HttpStatus.OK)
  @Post('login/otp')
  loginOtp(@Body() dto: LoginOtpDto) {
    return this.iamService.loginWithOtp(dto.verificationToken);
  }

  @ApiOperation({
    summary: 'Rotate the session',
    description: [
      'Exchanges a refresh token for a new access/refresh pair. The presented token is revoked, so each one works exactly once.',
      '',
      'The token goes in the request body, not the `Authorization` header.',
      '',
      'Replaying an already-used token is treated as theft: the whole token family for that device is revoked and every session derived from it stops working.',
    ].join('\n'),
  })
  @ApiBody({ type: RefreshDto })
  @ApiOkResponse({
    type: SessionResponse,
    description: 'New session issued; the presented token is now revoked.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Refresh token is missing, malformed, expired, unknown, or was already used.',
  })
  @Throttle({ default: REFRESH_THROTTLE })
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(
    @CurrentUser() user: { userId: string; tokenId: string; raw: string },
  ) {
    return this.iamService.refresh(user.userId, user.tokenId, user.raw);
  }

  @ApiOperation({
    summary: 'Log out the current session',
    description:
      'Revokes the refresh token behind the current session. The access token keeps working until it expires (up to 15 minutes).',
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({
    type: SuccessMessageResponse,
    description: 'Refresh token revoked.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description: 'Access token missing, malformed, or expired.',
  })
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser() user: { userId: string; tokenId: string }) {
    return this.iamService.logout(user.userId, user.tokenId);
  }

  @ApiOperation({
    summary: 'Log out everywhere',
    description:
      'Revokes every active refresh token for the user, across all devices. Outstanding access tokens keep working until they expire.',
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({
    type: SuccessMessageResponse,
    description: 'All refresh tokens revoked.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description: 'Access token missing, malformed, or expired.',
  })
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout/all')
  logoutAll(@CurrentUser() user: { userId: string }) {
    return this.iamService.logoutAll(user.userId);
  }

  @ApiOperation({
    summary: 'Change the password',
    description: [
      'Sets a new password for the signed-in user and revokes every refresh token, including the current one, so all devices must sign in again.',
      '',
      'For accounts with no password set, `currentPassword` is not checked — this is how an OTP-only account gains a password.',
    ].join('\n'),
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({
    type: SuccessMessageResponse,
    description: 'Password changed; all sessions revoked.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Access token is missing/expired, the user no longer exists, or `currentPassword` is wrong.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  @Post('password/change')
  changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.iamService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @ApiOperation({
    summary: 'Confirm a password reset',
    description: [
      'Sets a new password using a verification token issued for the `RESET_PASSWORD` purpose. No authentication required — the token is the proof.',
      '',
      'Every refresh token for the account is revoked, so all devices must sign in again. Unlike the other verification-token endpoints, this one does not return a session.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: SuccessMessageResponse,
    description: 'Password reset; all sessions revoked.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Verification token is invalid, expired, already used, issued for a different purpose, or the account no longer exists.',
  })
  @ApiBadRequestResponse(BAD_BODY)
  @HttpCode(HttpStatus.OK)
  @Post('password/reset/confirm')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.iamService.resetPassword(
      dto.verificationToken,
      dto.newPassword,
    );
  }

  @ApiOperation({
    summary: 'Get the current user',
    description: 'Returns the profile of the account behind the access token.',
  })
  @ApiBearerAuth('access-token')
  @ApiOkResponse({ type: UserResponse, description: 'Current user profile.' })
  @ApiUnauthorizedResponse({
    type: ErrorResponse,
    description:
      'Access token is missing/expired, or the user no longer exists.',
  })
  @UseGuards(JwtAccessGuard)
  @Get('me')
  getMe(@CurrentUser() user: { userId: string }) {
    return this.iamService.getById(user.userId);
  }
}
