import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Why they left, if they felt like saying.
 *
 * Optional and never required by the UI: a deletion that cannot complete
 * without a reason is a deletion the user has to argue their way out of, and
 * both stores treat that as a dark pattern. Stored on the user row, which is
 * the one record that outlives the account.
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
