import { ApiProperty } from '@nestjs/swagger';

/**
 * One row of a people search.
 *
 * Deliberately NOT a UserProfileResponse: that carries a page of listings,
 * facets and a rating aggregate, which is a lot of work per row for a list
 * somebody is scrolling past. These are the fields a row actually prints.
 */
export class UserSearchItemResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) surname!: string | null;
  @ApiProperty({ nullable: true }) avatarThumbUrl!: string | null;
  @ApiProperty() isVerifiedRealtor!: boolean;
  @ApiProperty() followerCount!: number;
  @ApiProperty({ description: 'Live listings only.' }) listingCount!: number;
}

export class UserSearchResponse {
  @ApiProperty({ description: 'Matches in total, for the term in force.' })
  total!: number;

  @ApiProperty({ type: [UserSearchItemResponse] })
  items!: UserSearchItemResponse[];
}
