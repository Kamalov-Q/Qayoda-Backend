import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'passw0rd', format: 'password' })
  @IsString()
  password: string;
}
