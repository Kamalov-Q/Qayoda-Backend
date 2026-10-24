import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';
import { SendMessageDto } from './send-message.dto';

/**
 * Writing to a PERSON rather than about an advert.
 *
 * The sellers directory puts profiles in front of people, and a profile with
 * no live listing has no advert to hang a thread on. One conversation per
 * pair, whichever way round it is opened.
 */
export class StartDirectConversationDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Who is being written to. They become the host — the role matches the listing case, where the host is whoever was approached.',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    type: SendMessageDto,
    description: 'The first message. A thread is never created empty.',
  })
  @ValidateNested()
  @Type(() => SendMessageDto)
  message: SendMessageDto;
}
