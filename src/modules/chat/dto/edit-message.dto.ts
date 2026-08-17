import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditMessageDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 4000,
    example: 'Assalomu alaykum, kvartira hali bandmi?',
    description: 'The replacement text. The previous body is kept for audit.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body: string;
}
