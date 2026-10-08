import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, Matches, IsUUID, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from "class-validator";
import { PaymentProviderKind, PaymentStatus, TARIFF_ACTION_RE, TARIFF_ACTIONS, TOPUP_MAX, TOPUP_MIN } from "../billing.constants";

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

export class CreateTariffDto {
    @ApiProperty({
        example: 'LISTING_PROMOTE',
        description: `What this prices. ${TARIFF_ACTIONS.join(', ')} are charged by the server automatically; any other UPPER_SNAKE code is a custom tariff.`,
    })
    @Matches(TARIFF_ACTION_RE, { message: 'action must be UPPER_SNAKE_CASE, 2-40 characters' })
    action: string;

    @ApiProperty({ maxLength: 120 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    nameUz: string;

    @ApiProperty({ maxLength: 120 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    nameRu: string;

    @ApiProperty({ example: 5000, description: "so'm" })
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(TOPUP_MAX)
    price: number;

    @ApiPropertyOptional({ example: 7, description: 'Days the paid effect lasts. Required for LISTING_PROMOTE, refused for the built-in one-off actions, optional for custom ones.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(365)
    durationDays?: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/** Everything but the action: what a tariff prices cannot change after the fact. */
export class PatchTariffDto extends PartialType(OmitType(CreateTariffDto, ['action'] as const)) { }

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

