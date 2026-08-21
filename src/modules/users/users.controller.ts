import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../iam/guards/jwt-access.guard';
import { ErrorResponse } from '../iam/responses/error.response';
import { UsersService } from './users.service';
import { UserProfileResponse } from './responses/public-user.response';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAccessGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({
    summary: "Open another user's profile",
    description: [
      'What a tap on an avatar in a chat — or on the owner of a listing — opens: their name, contact details and every ad they have live.',
      '',
      'Called with your own id it returns your own card; nothing here is hidden from the subject.',
    ].join('\n'),
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'User id.',
  })
  @ApiOkResponse({ type: UserProfileResponse })
  @ApiUnauthorizedResponse({ type: ErrorResponse })
  @ApiNotFoundResponse({
    type: ErrorResponse,
    description: 'No user exists with this id.',
  })
  @Get(':id')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getProfileWithListings(id);
  }
}
