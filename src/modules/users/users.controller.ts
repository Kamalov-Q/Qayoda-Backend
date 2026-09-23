import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { ErrorResponse } from 'src/shared/responses/error.response';
import { UsersService } from './users.service';
import { UserProfileResponse } from './responses/public-user.response';
import { OwnerListingsQueryDto } from './dto/owner-listings.query.dto';

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

  @ApiOperation({
    summary: "One page of a user's listings",
    description:
      'The profile card above carries the first 20 and the real total; this serves the rest as the reader scrolls. Live listings only, newest first.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'User id.' })
  @Get(':id/listings')
  getListings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OwnerListingsQueryDto,
  ) {
    return this.users.findListingsByOwner(id, query.limit, query.offset);
  }
}
