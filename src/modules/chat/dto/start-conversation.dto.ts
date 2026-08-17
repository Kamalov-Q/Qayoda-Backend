import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SendMessageDto } from './send-message.dto';

export class StartConversationDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34',
    description:
      'The listing being enquired about. Its owner becomes the host; the caller becomes the guest.',
  })
  @IsUUID()
  listingId: string;

  @ApiProperty({
    type: SendMessageDto,
    description:
      'The opening message. A conversation is never created empty, so this is required.',
  })
  @ValidateNested()
  @Type(() => SendMessageDto)
  message: SendMessageDto;
}
