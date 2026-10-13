import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard";
import { WalletService } from "./wallet.service";
import { TopupService } from "./topup.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user.type";
import { PageQueryDto, PaynetLinkQueryDto, TopupDto } from "./dto/billing.dto";
import { PhoneRequiredGuard } from "../auth/guards/phone-required.guard";
import { PaynetProvider } from "./providers/paynet/paynet.provider";
import { PaymentProviderKind } from "./billing.constants";

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('wallet')
export class WalletController {
    constructor(
        private readonly wallet: WalletService,
        private readonly topup: TopupService,
        private readonly paynet: PaynetProvider,
    ) { }

    @Get()
    async overview(@CurrentUser() user: AuthUser) {
        const data = await this.wallet.overview(user.sub);
        // Paynet is push-model: no order to create, so it is not in TopupService.
        const providers = [...this.topup.availableProviders(), ...(this.paynet.enabled ? [PaymentProviderKind.PAYNET] : [])];
        return { ...data, providers }
    }

    @Get('transactions')
    transactions(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
        return this.wallet.listTransactions(user.sub, q.limit, q.offset);
    }

    @Get('transactions/:id')
    transaction(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.wallet.getTransaction(user.sub, id);
    }

    @Post('topup')
    @UseGuards(PhoneRequiredGuard)
    createTopup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
        return this.topup.createTopup(user.sub, dto.amount, dto.provider, dto.clientId);
    }

    /** Paynet checkout link for this user's account number; the app opens it. */
    @Get('paynet-link')
    async paynetLink(@CurrentUser() user: AuthUser, @Query() q: PaynetLinkQueryDto) {
        if (!this.paynet.enabled) throw new BadRequestException({ code: 'PROVIDER_UNAVAILABLE', message: 'PAYNET is not enabled' });
        const accountNo = await this.wallet.accountNo(user.sub);
        return { accountNo, payUrl: this.paynet.payUrl(accountNo, q.amount) };
    }

    @Get('topup/:id')
    topupStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.topup.getTopup(user.sub, id);
    }

}