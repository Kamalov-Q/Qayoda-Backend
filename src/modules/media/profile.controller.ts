import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { UsersService } from '../users/users.service';
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
}
