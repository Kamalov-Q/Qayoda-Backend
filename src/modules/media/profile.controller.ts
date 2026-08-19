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
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../iam/guards/jwt-access.guard';
import { CurrentUser } from '../iam/guards/current-user.decorator';
import { IamService } from '../iam/iam.service';
import { UpdateProfileDto } from '../iam/dto/update-profile.dto';
import { MediaFacade } from './media.facade';

const AVATAR_MAX_SIZE = 5 * 1024 * 1024;

@ApiTags('profile')
@ApiBearerAuth('access-token')
@UseGuards(JwtAccessGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly iamService: IamService,
    private readonly media: MediaFacade,
  ) {}

  @Get()
  getProfile(@CurrentUser() user: { userId: string }) {
    return this.iamService.getProfile(user.userId);
  }

  @Patch()
  updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.iamService.updateProfile(user.userId, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_SIZE } }),
  )
  async uploadAvatar(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Fayl yuborilmadi');
    const avatar = await this.media.processAvatar(file.buffer);
    return this.iamService.setAvatar(user.userId, avatar);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: { userId: string }) {
    return this.iamService.removeAvatar(user.userId);
  }
}
