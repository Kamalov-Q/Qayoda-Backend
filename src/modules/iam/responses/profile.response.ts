import { ApiProperty } from '@nestjs/swagger';

export class ProfileResponse {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) surname: string | null;
  @ApiProperty({ nullable: true }) avatarUrl: string | null;
  @ApiProperty({ nullable: true }) avatarThumbUrl: string | null;
  @ApiProperty({ nullable: true }) phoneNumber: string | null;
  @ApiProperty() createdAt: Date;
}

/** What other users see — no email */
export class PublicProfileResponse {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) surname: string | null;
  @ApiProperty({ nullable: true }) avatarThumbUrl: string | null;
  @ApiProperty({ nullable: true }) phoneNumber: string | null;
}
