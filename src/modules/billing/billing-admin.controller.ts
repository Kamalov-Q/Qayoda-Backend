import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { BillingAdminService } from './billing-admin.service';
import {
    AdjustWalletDto, AdminAdjustmentsQueryDto, AdminFreeGrantsQueryDto, AdminPaymentsQueryDto, CreateBonusTierDto, CreateTariffDto, PageQueryDto, PatchBonusTierDto, PatchTariffDto,
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

    @Post('tariffs')
    createTariff(@Body() dto: CreateTariffDto) { return this.admin.createTariff(dto); }

    @Patch('tariffs/:id')
    patchTariff(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatchTariffDto) { return this.admin.patchTariff(id, dto); }

    @Delete('tariffs/:id')
    deleteTariff(@Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteTariff(id); }

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

    @Get('payments/:id')
    paymentDetail(@Param('id', ParseUUIDPipe) id: string) {
        return this.admin.paymentDetail(id);
    }

    /** The audit trail for the endpoint below it. */
    @Get('wallet-adjustments')
    listAdjustments(@Query() q: AdminAdjustmentsQueryDto) {
        return this.admin.listAdjustments(
            { userId: q.userId, adminId: q.adminId, direction: q.direction },
            q.limit,
            q.offset,
        );
    }

    @Post('wallets/:userId/adjust')
    adjust(@CurrentUser() admin: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: AdjustWalletDto) {
        return this.admin.adjustWallet(admin.sub, userId, dto);
    }

    /**
     * Who has used their free first post.
     *
     * Only used grants are rows, so an account absent from this list still
     * has its free go. `actions` in the response names the eligible set, so
     * the dashboard does not hardcode LISTING_POST.
     */
    @Get('free-grants')
    listFreeGrants(@Query() q: AdminFreeGrantsQueryDto) {
        return this.admin.listFreeGrants(
            { q: q.q, userId: q.userId, action: q.action },
            q.limit,
            q.offset,
        );
    }

    /** Give the free post back. 404 when they never used it. */
    @Delete('free-grants/:userId/:action')
    resetFreeGrant(@Param('userId', ParseUUIDPipe) userId: string, @Param('action') action: string) {
        return this.admin.resetFreeGrant(userId, action);
    }
}