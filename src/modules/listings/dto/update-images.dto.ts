import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImageInputDto {
  @IsString() url: string;
  @IsString() thumbUrl: string;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;
  @Type(() => Number) @IsInt() @Min(0) position: number;
  @IsBoolean() isPrimary: boolean;
}

export class UpdateImagesDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ImageInputDto)
  images: ImageInputDto[];
}
