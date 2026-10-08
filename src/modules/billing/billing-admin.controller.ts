import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { BillingAdminService } from './billing-admin.service';
import {
    AdjustWalletDto, AdminPaymentsQueryDto, CreateBonusTierDto, PageQueryDto, PatchBonusTierDto, PatchTariffDto,
} from './dto/billing.dto';

@ApiTags('admin-billing')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BillingAdminController {
    constructor(private readonly admin: BillingAdminService) { }

    @Get('tariffs')
    listTariffs() { return this.admin.listTariffs(); }

    @Patch('tariffs/:key')
    patchTariff(@Param('key') key: string, @Body() dto: PatchTariffDto) { return this.admin.patchTariff(key, dto); }

    @Get('bonus-tiers')
    listBonusTiers() { return this.admin.listBonusTiers(); }

    @Post('bonus-tiers')
    createBonusTier(@Body() dto: CreateBonusTierDto) { return this.admin.createBonusTier(dto); }

    @Patch('bonus-tiers/:id')
    patchBonusTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchBonusTierDto) {
        return this.admin.patchBonusTier(id, dto);
    }

    @Delete('bonus-tiers/:id')
    deleteBonusTier(@Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteBonusTier(id); }

    @Get('payments')
    listPayments(@Query() q: AdminPaymentsQueryDto) {
        return this.admin.listPayments(q.status, q.provider, q.limit, q.offset);
    }

    @Get('wallets')
    listWallets(@Query() q: PageQueryDto) { return this.admin.listWallets(q.limit, q.offset); }

    @Post('wallets/:userId/adjust')
    adjust(@CurrentUser() admin: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AdjustWalletDto) {
        return this.admin.adjustWallet(admin.sub, userId, dto);
    }
}