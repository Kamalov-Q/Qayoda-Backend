
/**
 * Malformed JSON fails in the body parser, before any route — so only a GLOBAL
 * filter sees it. On the Paynet path it must still be a JSON-RPC answer
 * (-32700), not Nest's {statusCode: 400}. Everything else passes through.
 */

import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request, Response } from "express";
import { PAYNET } from "./paynet.provider";

@Catch()
export class PaynetParseErrorFilter extends BaseExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const req = http.getRequest<Request | undefined>();
        if (host.getType() !== 'http' || !req?.path?.startsWith('/api/paynet')) return super.catch(exception, host);

        const status = exception instanceof HttpException ? exception.getStatus() : 500;
        const code = status === 400 ? PAYNET.PARSE : status < 500 ? PAYNET.BAD_REQUEST : PAYNET.INTERNAL;
        http.getResponse<Response>().status(200).json({
            jsonrpc: '2.0', id: null,
            error: { code, message: code === PAYNET.PARSE ? 'Ошибка парсинга JSON' : 'Неверный JSON-RPC запрос' },
        });

    }
}