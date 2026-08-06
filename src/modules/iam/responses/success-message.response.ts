import { ApiProperty } from '@nestjs/swagger';

export class SuccessMessageResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Password changed successfully' })
  message: string;
}
