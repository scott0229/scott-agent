import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';

export async function GET(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const strategy = await db.prepare('SELECT * FROM STRATEGIES WHERE id = ?')
            .bind(params.id)
            .first();

        if (!strategy) {
            return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }

        // Get stock trades
        const stocksQuery = `
            SELECT st.* FROM STOCK_TRADES st
            INNER JOIN STRATEGY_STOCKS ss ON st.id = ss.stock_trade_id
            WHERE ss.strategy_id = ?
        `;
        const { results: stocks } = await db.prepare(stocksQuery).bind(params.id).all();

        // Get options
        const optionsQuery = `
            SELECT o.* FROM OPTIONS o
            INNER JOIN STRATEGY_OPTIONS so ON o.id = so.option_id
            WHERE so.strategy_id = ?
        `;
        const { results: options } = await db.prepare(optionsQuery).bind(params.id).all();

        return NextResponse.json({
            strategy: {
                ...strategy,
                stocks: stocks || [],
                options: options || [],
            }
        });
    } catch (error) {
        console.error('Fetch strategy error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { name, status, stockTradeIds, optionIds, optionStrategy, stockStrategy, stockStrategyParams } = body;

        if (!name) {
            return NextResponse.json({ error: '策略名稱為必填' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);

        // Get current strategy to validate ownership
        const strategy = await db.prepare('SELECT * FROM STRATEGIES WHERE id = ?')
            .bind(params.id)
            .first();

        if (!strategy) {
            return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }

        const strategyData = strategy as any;

        // Validate that all stock trades belong to the same user
        if (stockTradeIds && stockTradeIds.length > 0) {
            const stockCheck = await db.prepare(`
                SELECT COUNT(*) as count FROM STOCK_TRADES 
                WHERE id IN (${stockTradeIds.map(() => '?').join(',')}) 
                AND (owner_id = ? OR user_id = ?)
            `).bind(...stockTradeIds, strategyData.owner_id, strategyData.user_id).first();

            if ((stockCheck as any).count !== stockTradeIds.length) {
                return NextResponse.json({ error: '部分股票交易不屬於此用戶' }, { status: 400 });
            }
        }

        // Validate that all options belong to the same user
        if (optionIds && optionIds.length > 0) {
            const optionCheck = await db.prepare(`
                SELECT COUNT(*) as count FROM OPTIONS 
                WHERE id IN (${optionIds.map(() => '?').join(',')}) 
                AND (owner_id = ? OR user_id = ?)
            `).bind(...optionIds, strategyData.owner_id, strategyData.user_id).first();

            if ((optionCheck as any).count !== optionIds.length) {
                return NextResponse.json({ error: '部分期權交易不屬於此用戶' }, { status: 400 });
            }
        }

        // Update strategy
        await db.prepare(`
            UPDATE STRATEGIES SET name = ?, status = ?, option_strategy = ?, stock_strategy = ?, stock_strategy_params = ?, updated_at = unixepoch()
            WHERE id = ?
        `).bind(name, status || '進行中', optionStrategy || null, stockStrategy || null, stockStrategyParams || null, params.id).run();

        // Delete existing associations
        await db.prepare('DELETE FROM STRATEGY_STOCKS WHERE strategy_id = ?').bind(params.id).run();
        await db.prepare('DELETE FROM STRATEGY_OPTIONS WHERE strategy_id = ?').bind(params.id).run();

        // Insert new stock trade associations
        if (stockTradeIds && stockTradeIds.length > 0) {
            for (const stockId of stockTradeIds) {
                await db.prepare(`
                    INSERT INTO STRATEGY_STOCKS (strategy_id, stock_trade_id)
                    VALUES (?, ?)
                `).bind(params.id, stockId).run();
            }
        }

        // Insert new option associations
        if (optionIds && optionIds.length > 0) {
            for (const optionId of optionIds) {
                await db.prepare(`
                    INSERT INTO STRATEGY_OPTIONS (strategy_id, option_id)
                    VALUES (?, ?)
                `).bind(params.id, optionId).run();
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update strategy error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const result = await db.prepare('DELETE FROM STRATEGIES WHERE id = ?')
            .bind(params.id)
            .run();

        if (result.meta.changes === 0) {
            return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete strategy error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
