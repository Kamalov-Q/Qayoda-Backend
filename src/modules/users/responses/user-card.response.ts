import { ApiProperty } from '@nestjs/swagger';

/**
 * The profile card another user opens from a chat or a listing — the public
 * profile plus the contact details a buyer needs to reach the owner.
 *
 * No email. The address here is whatever Google handed over at sign-in, not
 * something the user chose to publish, so it stays on their own profile only.
 * The phone number is different: it is the contact detail this marketplace
 * exists to exchange, and it only lands on an account by the owner passing an
 * SMS code.
 */
export class UserCardResponse {
  @ApiProperty({ format: 'uuid' }) id: string;

  @ApiProperty({
    nullable: true,
    example: 'Ada Lovelace',
    description: '`name` and `surname` joined; null when both are empty.',
  })
  fullName: string | null;

  @ApiProperty({ nullable: true }) name: string | null;
  @ApiProperty({ nullable: true }) surname: string | null;

  @ApiProperty({ nullable: true, example: '+998901234567' })
  phoneNumber: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://cdn.example.com/avatar/3f1c9d2e.jpg',
    description: 'Full-size avatar. Prefer this one when it is not null.',
  })
  avatarUrl: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Fallback for when `avatarUrl` is null.',
  })
  avatarThumbUrl: string | null;

  @ApiProperty({ description: 'Manually verified by an admin.' })
  isVerifiedRealtor: boolean;

  @ApiProperty({ description: 'When they joined.' }) createdAt: Date;
}
