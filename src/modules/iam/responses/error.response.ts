import { ApiProperty } from '@nestjs/swagger';

/**
 * Shape of Nest's default HttpException body, used for the documented
 * failure responses across the auth endpoints.
 */
export class ErrorResponse {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({
    example: 'Invalid credentials!',
    description:
      'A string for thrown exceptions, or an array of violations when body validation fails.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message: string | string[];

  @ApiProperty({ example: 'Unauthorized', required: false })
  error?: string;
}
