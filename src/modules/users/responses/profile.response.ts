import { ApiProperty } from '@nestjs/swagger';
import {
  GENDERS,
  type Gender,
  type SocialLinks,
} from '../user-profile.constants';

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

  @ApiProperty({
    nullable: true,
    format: 'date',
    example: '1998-04-23',
    description: 'Only ever on your OWN profile, never a public one.',
  })
  birthDate: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Whole years, derived from `birthDate`. Null if unknown.',
  })
  age: number | null;

  @ApiProperty({ nullable: true, enum: GENDERS }) gender: Gender | null;
  @ApiProperty({ nullable: true }) address: string | null;
  @ApiProperty({ nullable: true }) bio: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Handle or URL per platform, for the six with icons.',
    example: { instagram: 'growen.uz', whatsapp: '+998901234567' },
  })
  socialLinks: SocialLinks | null;
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
