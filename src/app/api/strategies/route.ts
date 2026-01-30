import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export const dynamic = 'force-dynamic'; // Ensure no caching

export async function GET(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const ownerId = searchParams.get('ownerId');
        const year = searchParams.get('year');

        const db = await getDb();
        let query = 'SELECT * FROM STRATEGIES';
        const params: any[] = [];
        let whereAdded = false;

        // Add year filter
        if (year && year !== 'All') {
            query += ' WHERE year = ?';
            params.push(parseInt(year));
            whereAdded = true;
        }

        if (ownerId) {
            query += whereAdded ? ' AND owner_id = ?' : ' WHERE owner_id = ?';
            params.push(ownerId);
            whereAdded = true;
        } else if (userId) {
            query += whereAdded ? ' AND user_id = ?' : ' WHERE user_id = ?';
            params.push(userId);
        }

        query += ' ORDER BY created_at DESC';

        const { results } = await db.prepare(query).bind(...params).all();

        // Fetch associated stocks and options for each strategy
        const strategiesWithDetails = await Promise.all(
            (results as any[]).map(async (strategy) => {
                // Get stock trades
                const stocksQuery = `
                    SELECT st.* FROM STOCK_TRADES st
                    INNER JOIN STRATEGY_STOCKS ss ON st.id = ss.stock_trade_id
                    WHERE ss.strategy_id = ?
                `;
                const { results: stocks } = await db.prepare(stocksQuery).bind(strategy.id).all();

                // Get options
                const optionsQuery = `
                    SELECT o.* FROM OPTIONS o
                    INNER JOIN STRATEGY_OPTIONS so ON o.id = so.option_id
                    WHERE so.strategy_id = ?
                `;
                const { results: options } = await db.prepare(optionsQuery).bind(strategy.id).all();

                return {
                    ...strategy,
                    stocks: stocks || [],
                    options: options || [],
                };
            })
        );

        return NextResponse.json({ strategies: strategiesWithDetails });
    } catch (error) {
        console.error('Fetch strategies error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { name, userId, ownerId, year, status, stockTradeIds, optionIds } = body;

        if (!name) {
            return NextResponse.json({ error: '策略名稱為必填' }, { status: 400 });
        }

        const db = await getDb();
        const strategyYear = year || new Date().getFullYear();
        const strategyStatus = status || '進行中';

        // Validate that all stock trades belong to the same user
        if (stockTradeIds && stockTradeIds.length > 0) {
            const stockCheck = await db.prepare(`
                SELECT COUNT(*) as count FROM STOCK_TRADES 
                WHERE id IN (${stockTradeIds.map(() => '?').join(',')}) 
                AND (owner_id = ? OR user_id = ?)
            `).bind(...stockTradeIds, ownerId, userId).first();

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
            `).bind(...optionIds, ownerId, userId).first();

            if ((optionCheck as any).count !== optionIds.length) {
                return NextResponse.json({ error: '部分期權交易不屬於此用戶' }, { status: 400 });
            }
        }

        // Create strategy
        const result = await db.prepare(`
            INSERT INTO STRATEGIES (name, user_id, owner_id, year, status, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch())
        `).bind(name, userId || null, ownerId || null, strategyYear, strategyStatus).run();

        const strategyId = result.meta.last_row_id;

        // Insert stock trade associations
        if (stockTradeIds && stockTradeIds.length > 0) {
            for (const stockId of stockTradeIds) {
                await db.prepare(`
                    INSERT INTO STRATEGY_STOCKS (strategy_id, stock_trade_id)
                    VALUES (?, ?)
                `).bind(strategyId, stockId).run();
            }
        }

        // Insert option associations
        if (optionIds && optionIds.length > 0) {
            for (const optionId of optionIds) {
                await db.prepare(`
                    INSERT INTO STRATEGY_OPTIONS (strategy_id, option_id)
                    VALUES (?, ?)
                `).bind(strategyId, optionId).run();
            }
        }

        return NextResponse.json({ success: true, id: strategyId });
    } catch (error: any) {
        console.error('Create strategy error:', error);
        return NextResponse.json({ error: error.message || '伺服器內部錯誤' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const token = req.cookies.get('token')?.value;
        const user = token ? await verifyToken(token) : null;

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('userId');
        const year = searchParams.get('year');

        if (!userId || !year) {
            return NextResponse.json({ error: 'Missing userId or year' }, { status: 400 });
        }

        const db = await getDb();
        const result = await db.prepare('DELETE FROM STRATEGIES WHERE user_id = ? AND year = ?')
            .bind(userId, parseInt(year))
            .run();

        return NextResponse.json({ success: true, deleted: result.meta.changes });
    } catch (error) {
        console.error('Delete all strategies error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
