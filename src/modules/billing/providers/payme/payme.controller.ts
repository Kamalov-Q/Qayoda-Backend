import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PaymeProvider } from "./payme.provider";

@ApiExcludeController()
@SkipThrottle()
@Controller('payme')
export class PaymeWebhookController {
    constructor(private readonly payme: PaymeProvider) { }

    @Post()
    @HttpCode(200)
    rpc(@Headers('authorization') auth: string | undefined, @Body() body: Record<string, unknown>) {
        return this.payme.handleRpc(auth, body);
    }

}
