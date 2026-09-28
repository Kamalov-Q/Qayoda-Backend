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

  @ApiProperty({
    example: 4,
    description:
      'Every live listing they have, not just the page above — what the ' +
      'profile prints beside "Ads".',
  })
  listingCount: number;

  @ApiProperty({
    type: Object,
    description:
      'The numbers across the top of the profile, over their live listings ' +
      'only: `{ listings, views, ratingAvg, ratingCount }`. `views` counts ' +
      'distinct viewers across everything they have posted; `ratingAvg` is ' +
      'weighted by each listing\'s rating count, and is null until somebody ' +
      'rates one.',
  })
  stats: {
    listings: number;
    views: number;
    ratingAvg: number | null;
    ratingCount: number;
  };

  @ApiProperty({
    type: Object,
    description:
      'What the profile\'s filter sheet offers: `{ purposes, categories }`, ' +
      'each a map of value to how many live listings carry it. An option ' +
      'absent from the map is one this seller has none of — do not offer it.',
  })
  facets: {
    purposes: Record<string, number>;
    categories: Record<string, number>;
  };
}
