import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface FiscalLine {
    title: string;
    unitPriceTiyin: number;
    count: number;
    totalTiyin: number;
    vatPercent: number;
    vatTiyin: number;
    mxik: string;
    packageCode: string;
    tin: string;

}

@Injectable()
export class FiscalService {
    constructor(
        private readonly config: ConfigService
    ) { }

    /**
     * Every value a receipt needs. All-or-nothing: with any of them missing
     * no receipt is attempted, rather than one throwing halfway through a
     * payment callback.
     */
    get enabled(): boolean {
        return ['FISCAL_MXIK', 'FISCAL_PACKAGE_CODE', 'FISCAL_TIN'].every((k) => !!this.config.get<string>(k)?.trim());
    }

    topupLine(amountTiyin: number): FiscalLine {
        const vatPercent = Number(this.config.get<string>('FISCAL_VAT_PERCENT') || 0);
        if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
            throw new Error(`FISCAL_VAT_PERCENT must be 0..100, got "${this.config.get('FISCAL_VAT_PERCENT')}"`);
        }

        // VAT is inside the price: vat = total * p / (100 + p)
        const vatTiyin = vatPercent > 0 ? Math.round((amountTiyin * vatPercent) / (100 + vatPercent)) : 0;

        return {
            title: this.config.get<string>('FISCAL_ITEM_NAME') ?? "Growen City balansini to'ldirish",
            unitPriceTiyin: amountTiyin,
            count: 1,
            totalTiyin: amountTiyin,
            vatPercent,
            vatTiyin,
            mxik: this.config.getOrThrow<string>('FISCAL_MXIK'),
            packageCode: this.config.getOrThrow<string>('FISCAL_PACKAGE_CODE'),
            tin: this.config.getOrThrow<string>('FISCAL_TIN')
        }

    }

}