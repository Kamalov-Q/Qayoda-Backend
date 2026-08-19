import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 120, { message: 'Name must be between 2 and 120 characters' })
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120, { message: 'Surname must be between 2 and 120 characters' })
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  surname?: string;

  /** Uzbek mobile: +998 followed by 9 digits */
  @IsOptional()
  @Matches(/^\+998\d{9}$/, {
    message: "Telefon raqami +998XXXXXXXXX ko'rinishida bo'lishi kerak",
  })
  @Transform(({ value }: { value: string }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  phoneNumber?: string;
}
