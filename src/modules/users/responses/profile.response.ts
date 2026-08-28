import { ApiProperty } from '@nestjs/swagger';

export class ProfileResponse {
  @ApiProperty({ format: 'uuid' }) id: string;

  @ApiProperty({
    nullable: true,
    description: 'Null unless a Google account is linked.',
  })
  email: string | null;

  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) surname: string | null;
  @ApiProperty({ nullable: true }) avatarUrl: string | null;
  @ApiProperty({ nullable: true }) avatarThumbUrl: string | null;

  @ApiProperty({
    nullable: true,
    example: '+998901234567',
    description: 'Null unless a phone number was verified by SMS.',
  })
  phoneNumber: string | null;

  @ApiProperty({ enum: ['uz', 'ru'] }) language: 'uz' | 'ru';
  @ApiProperty() isVerifiedRealtor: boolean;
  @ApiProperty() createdAt: Date;
}

/** What other users see — no email */
export class PublicProfileResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) surname: string | null;
  @ApiProperty({ nullable: true }) avatarUrl: string | null;
  @ApiProperty({ nullable: true }) avatarThumbUrl: string | null;
  @ApiProperty({ nullable: true }) phoneNumber: string | null;
}
