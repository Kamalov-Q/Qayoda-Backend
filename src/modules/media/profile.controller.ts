import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { UsersService } from '../users/users.service';
import { DeleteAccountDto } from '../users/dto/delete-account.dto';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { ProfileResponse } from '../users/responses/profile.response';
import { MediaFacade } from './media.facade';

const AVATAR_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('Profile')
@ApiBearerAuth('access-token')
@UseGuards(JwtAccessGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly media: MediaFacade,
  ) {}

  @ApiOperation({ summary: 'Your own profile' })
  @ApiOkResponse({ type: ProfileResponse })
  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.sub);
  }

  @ApiOperation({
    summary: 'Edit your name',
    description:
      'Phone and email are not editable: each is written only by the provider that verified it.',
  })
  @ApiOkResponse({ type: ProfileResponse })
  @Patch()
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.sub, dto);
  }

  @ApiOperation({ summary: 'Replace your avatar' })
  @ApiOkResponse({ type: ProfileResponse })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_SIZE } }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    const avatar = await this.media.processAvatar(file.buffer);
    return this.users.setAvatar(user.sub, avatar);
  }

  @ApiOperation({ summary: 'Remove your avatar' })
  @ApiOkResponse({ type: ProfileResponse })
  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.removeAvatar(user.sub);
  }

  /**
   * Required by both stores for any app that lets you create an account, and
   * the one route here that cannot be undone.
   *
   * Throttled hard: three attempts a minute is more than a person needs and
   * far less than a stolen token could do damage with.
   */
  @ApiOperation({
    summary: 'Delete your account',
    description:
      'Irreversible. Personal details are scrubbed, listings and videos come ' +
      'down, every session is revoked and the phone number is freed for a ' +
      'fresh sign-up. Financial records are kept, detached from the person, ' +
      'for as long as tax law requires.',
  })
  @ApiNoContentResponse()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    await this.users.deleteOwnAccount(user.sub, dto.reason);
  }
}
