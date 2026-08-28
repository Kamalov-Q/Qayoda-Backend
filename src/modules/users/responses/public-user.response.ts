import { ApiProperty } from '@nestjs/swagger';
import { UserCardResponse } from './user-card.response';

export class UserProfileResponse extends UserCardResponse {
  @ApiProperty({
    isArray: true,
    type: Object,
    description:
      'Their ads — every `ACTIVE` listing they own, newest first, in the same shape as `/listings/mine`. Drafts and archived listings stay private to the owner.',
  })
  listings: unknown[];

  @ApiProperty({ example: 4, description: 'Length of `listings`.' })
  listingCount: number;
}
