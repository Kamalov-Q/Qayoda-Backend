import { All, Body, Controller, Headers, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { PaynetProvider } from "./paynet.provider";
import type { Request, Response } from "express";

@ApiExcludeController()
@SkipThrottle()
@Controller('paynet')
export class PaynetWebhookController {
    constructor(private readonly paynet: PaynetProvider) { }

    // @All, not @Post: a non-POST call must get JSON-RPC -32300, not Nest's 404.
    @All()
    async rpc(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
        @Headers('authorization') auth: string | undefined,
        @Body() body: Record<string, unknown>,
    ) {
        const reply = await this.paynet.handle(req.method, req.ip, auth, body);
        res.status(reply.httpStatus);
        return reply.body;
    }

}