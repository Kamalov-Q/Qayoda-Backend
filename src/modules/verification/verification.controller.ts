import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ErrorResponse } from 'src/shared/responses/error.response';
import { UserRole } from 'src/shared/enums';
import { Roles, RolesGuard } from 'src/shared/guards/roles.guard';
import { VerificationService } from './verification.service';
import {
  AdminVerificationQueryDto,
  RejectVerificationDto,
  SubmitVerificationDto,
} from './dto/verification.dto';

@ApiTags('Verification')
@ApiBearerAuth('access-token')
@Controller('verification')
@UseGuards(JwtAccessGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @ApiOperation({
    summary: 'Where my application stands',
    description:
      'The badge itself plus the last application, if there is one. The ' +
      'uploaded documents are never returned.',
  })
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.verification.mine(user.sub);
  }

  @ApiOperation({
    summary: 'Apply for the verified badge',
    description:
      'Upload the three images through POST /media/verification/upload ' +
      'first, then send their URLs here. One application may be waiting at ' +
      'a time.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: '`ALREADY_VERIFIED`, or `REQUEST_PENDING`.',
  })
  // A phone number is the thing being vouched for; an account without one
  // has nothing for a passport to match against.
  @UseGuards(PhoneRequiredGuard)
  @Post()
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitVerificationDto) {
    return this.verification.submit(user.sub, dto);
  }
}

/**
 * The moderators' queue.
 *
 * Deciding an application also disposes of its documents — see
 * VerificationService.purgeDocuments. A decision here is therefore the last
 * moment anybody can look at them, which is on purpose.
 */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin/verification-requests')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @ApiOperation({ summary: 'Applications for the badge' })
  @Get()
  list(@Query() query: AdminVerificationQueryDto) {
    return this.verification.adminList(query);
  }

  @ApiOperation({
    summary: 'Give the badge',
    description: 'Marks the account verified and deletes the documents.',
  })
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.verification.approve(id, user.sub);
  }

  @ApiOperation({
    summary: 'Turn one down',
    description:
      'The reason is sent to the applicant as a support message, word for ' +
      'word, and the documents are deleted.',
  })
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVerificationDto,
  ) {
    return this.verification.reject(id, user.sub, dto.reason);
  }
}
