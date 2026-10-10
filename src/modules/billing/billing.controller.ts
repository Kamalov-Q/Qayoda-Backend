import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAccessGuard } from "../auth/guards/jwt-access.guard";
import { WalletService } from "./wallet.service";
import { TopupService } from "./topup.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user.type";
import { PageQueryDto, TopupDto } from "./dto/billing.dto";
import { PhoneRequiredGuard } from "../auth/guards/phone-required.guard";

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('wallet')
export class WalletController {
    constructor(
        private readonly wallet: WalletService,
        private readonly topup: TopupService
    ) { }

    @Get()
    async overview(@CurrentUser() user: AuthUser) {
        const data = await this.wallet.overview(user.sub);
        return { ...data, providers: this.topup.availableProviders() }
    }

    @Get('transactions')
    transactions(@CurrentUser() user: AuthUser, @Query() q: PageQueryDto) {
        return this.wallet.listTransactions(user.sub, q.limit, q.offset);
    }

    @Post('topup')
    @UseGuards(PhoneRequiredGuard)
    createTopup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
        return this.topup.createTopup(user.sub, dto.amount, dto.provider, dto.clientId);
    }

    @Get('topup/:id')
    topupStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
        return this.topup.getTopup(user.sub, id);
    }

}