import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { ClickProvider } from "./click.provider";

@ApiExcludeController()
@SkipThrottle()
@Controller('click')
export class ClickWebhookController {
    constructor(private readonly click: ClickProvider) { }

    @Post('prepare')
    @HttpCode(200)
    prepare(@Body() body: Record<string, string>) {
        return this.click.handleWebhook('prepare', body);
    }

    @Post('complete')
    @HttpCode(200)
    complete(@Body() body: Record<string, string>) {
        return this.click.handleWebhook('complete', body);
    }
}