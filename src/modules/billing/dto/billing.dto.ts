import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsUUID, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from "class-validator";
import { PaymentProviderKind, PaymentStatus, TOPUP_MAX, TOPUP_MIN } from "../billing.constants";

export class TopupDto {
    @ApiProperty({ example: 2000, description: "so'm" })
    @Type(() => Number)
    @IsInt()
    @Min(TOPUP_MIN)
    @Max(TOPUP_MAX)
    amount: number;

    @ApiPropertyOptional({ enum: PaymentProviderKind, default: PaymentProviderKind.CLICK })
    @IsOptional()
    @IsEnum(PaymentProviderKind)
    provider: PaymentProviderKind = PaymentProviderKind.CLICK;

    @ApiPropertyOptional({
        format: 'uuid',
        description: 'A UUID the app generates once per top-up attempt. Sending the same one again returns the same order instead of creating another.',
    })
    @IsOptional()
    @IsUUID()
    clientId?: string;

}

export class PageQueryDto {
    @ApiPropertyOptional({ default: 20, maximum: 50 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit = 20;

    @ApiPropertyOptional({ default: 0 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    offset = 0;
}

export class AdminPaymentsQueryDto extends PageQueryDto {
    @ApiPropertyOptional({ enum: PaymentStatus })
    @IsOptional()
    @IsEnum(PaymentStatus)
    status?: PaymentStatus;

    @ApiPropertyOptional({ enum: PaymentProviderKind })
    @IsOptional()
    @IsEnum(PaymentProviderKind)
    provider?: PaymentProviderKind;

}

export class PatchTariffDto {
    @ApiPropertyOptional({ maxLength: 120 })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    nameUz?: string;

    @ApiPropertyOptional({ maxLength: 120 })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    nameRu?: string;

    @ApiPropertyOptional({ example: 7, description: 'Days the paid effect lasts. Only for tariffs that have a duration.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(365)
    durationDays?: number;

    @ApiPropertyOptional({ example: 2000, description: "so'm" })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(TOPUP_MAX)
    price?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

}

export class CreateBonusTierDto {
    @ApiProperty({ example: 1000 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(TOPUP_MAX)
    minAmount: number;

    @ApiProperty({ example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    percent: number;

}

export class PatchBonusTierDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(TOPUP_MAX)
    minAmount?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    percent?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

}

export class AdjustWalletDto {
    @ApiProperty({ example: -5000, description: "so'm, positive credits, negative debits" })
    @Type(() => Number)
    @IsInt()
    @NotEquals(0)
    @Min(-TOPUP_MAX)
    @Max(TOPUP_MAX)
    amount: number;

    @ApiProperty({ example: 'Refund for duplicate charge, ticket $41' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    note: string;
}

