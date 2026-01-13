import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

interface ImportOption {
    status: string;
    operation?: string | null;
    open_date: number;
    to_date?: number | null;
    settlement_date?: number | null;
    quantity: number;
    underlying: string;
    type: string;
    strike_price: number;
    collateral?: number | null;
    premium?: number | null;
    final_profit?: number | null;
    profit_percent?: number | null;
    delta?: number | null;
    iv?: number | null;
    capital_efficiency?: number | null;
    owner_id: number;
    year?: number;
}

// POST: Import options from JSON array
export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: '權限不足' }, { status: 401 });
        }

        const body = await req.json();
        const { options } = body;

        if (!Array.isArray(options)) {
            return NextResponse.json({ error: '無效的資料格式' }, { status: 400 });
        }

        const db = await getDb();

        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const option of options as ImportOption[]) {
            try {
                // Validate required fields
                if (!option.status || !option.open_date || !option.quantity ||
                    !option.underlying || !option.type || !option.strike_price || !option.owner_id) {
                    errors.push(`跳過：缺少必要欄位`);
                    skipped++;
                    continue;
                }

                // Check for duplicate (same owner, underlying, type, strike_price, open_date)
                const existing = await db.prepare(
                    `SELECT id FROM OPTIONS 
                     WHERE owner_id = ? AND underlying = ? AND type = ? 
                     AND strike_price = ? AND open_date = ?`
                ).bind(
                    option.owner_id,
                    option.underlying,
                    option.type,
                    option.strike_price,
                    option.open_date
                ).first();

                if (existing) {
                    errors.push(`跳過：交易紀錄已存在 (${option.underlying} ${option.type} ${option.strike_price})`);
                    skipped++;
                    continue;
                }

                // Calculate profit_percent if not provided
                let profit_percent = option.profit_percent;
                if (option.final_profit !== undefined && option.final_profit !== null &&
                    option.premium && option.premium !== 0) {
                    profit_percent = option.final_profit / option.premium;
                }

                const optionYear = option.year || new Date().getFullYear();

                // Insert new option
                await db.prepare(`
                    INSERT INTO OPTIONS (
                        status, operation, open_date, to_date, settlement_date,
                        quantity, underlying, type, strike_price,
                        collateral, premium, final_profit, profit_percent,
                        delta, iv, capital_efficiency, owner_id, year, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
                `).bind(
                    option.status || 'Open',
                    option.operation || '無',
                    option.open_date,
                    option.to_date || null,
                    option.settlement_date || null,
                    option.quantity,
                    option.underlying,
                    option.type,
                    option.strike_price,
                    option.collateral || 0,
                    option.premium || 0,
                    option.final_profit || null,
                    profit_percent || null,
                    option.delta || null,
                    option.iv || null,
                    option.capital_efficiency || null,
                    option.owner_id,
                    optionYear
                ).run();

                imported++;
            } catch (error: any) {
                errors.push(`匯入失敗: ${error.message}`);
                skipped++;
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            skipped,
            total: options.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import options error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
