import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGroupFromRequest } from '@/lib/group';
import { verifyToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';

const generateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

// Helper to check for admin or manager role
async function checkAdmin(req: NextRequest) {
    const token = req.cookies.get('token')?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload || (payload.role !== 'admin' && payload.role !== 'manager')) {
        return null;
    }
    return payload;
}

interface ImportUser {
    user_id?: string | null;
    email: string;
    role: string;
    management_fee?: number | null;
    ib_account?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
    initial_cost?: number | null;
    initial_cash?: number | null;
    initial_management_fee?: number | null;
    initial_deposit?: number | null;

    start_date?: string | null;
    fee_exempt_months?: number | null;
    year?: number | null;
    deposits?: any[];
    net_equity_records?: any[];
    options?: any[];
    monthly_interest?: any[];
    stock_trades?: any[];
    strategies?: any[];
    monthly_fees?: any[];
}

// POST: Import users from JSON array
export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const body = await req.json();
        const { users, market_prices, annotations: importAnnotations, sourceYear } = body;

        const { searchParams } = new URL(req.url);
        const targetYear = searchParams.get('targetYear');

        // Validation: Export Year vs Import Target Year
        // If both present and not 'All', they must match.
        if (targetYear && sourceYear) {
            if (targetYear !== 'All' && sourceYear !== 'All' && String(targetYear) !== String(sourceYear)) {
                return NextResponse.json({
                    error: `年份不符：此檔案匯出年份為 ${sourceYear}，但您目前正在匯入至 ${targetYear} 年度。請切換至正確年份或選取 All。`
                }, { status: 400 });
            }
        }

        if (!Array.isArray(users)) {
            return NextResponse.json({ error: '無效的資料格式' }, { status: 400 });
        }

        const group = await getGroupFromRequest(req);
        const db = await getDb(group);
        const defaultPassword = '123456';
        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        let imported = 0;
        let skipped = 0;
        let updated = 0;
        const errors: string[] = [];

        for (const user of users as ImportUser[]) {
            try {
                // Validate required fields
                if (!user.email || !user.role) {
                    errors.push(`跳過：缺少必要欄位 (email 或 role)`);
                    skipped++;
                    continue;
                }

                const targetYear = user.year || 2025;

                // Check if user already exists by email or IB account
                const existing = await db.prepare(
                    `SELECT id FROM USERS WHERE (
                        email = ? 
                        OR (ib_account IS NOT NULL AND ib_account != '' AND ib_account = ?)
                    ) AND year = ?`
                ).bind(user.email, user.ib_account || null, targetYear).first();

                let targetUserId = existing ? existing.id : null;

                if (existing) {
                    // Update existing user
                    await db.prepare(
                        `UPDATE USERS SET 
                         role = ?, management_fee = ?, ib_account = ?, phone = ?, avatar_url = ?, initial_cost = ?, initial_cash = ?, initial_management_fee = ?, initial_deposit = ?, start_date = ?, fee_exempt_months = ?, updated_at = unixepoch()
                         WHERE id = ?`
                    ).bind(
                        user.role,
                        user.management_fee ?? null,
                        user.ib_account || null,
                        user.phone || null,
                        user.avatar_url || null,
                        user.initial_cost || 0,
                        user.initial_cash ?? 0,
                        user.initial_management_fee ?? 0,
                        user.initial_deposit ?? 0,
                        user.start_date || null,
                        user.fee_exempt_months ?? 0,
                        existing.id
                    ).run();
                    updated++;
                } else {
                    // Insert new user
                    const { meta } = await db.prepare(
                        `INSERT INTO USERS (user_id, email, password, role, management_fee, ib_account, phone, avatar_url, initial_cost, initial_cash, initial_management_fee, initial_deposit, start_date, fee_exempt_months, year, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                    ).bind(
                        user.user_id || null,
                        user.email,
                        passwordHash,
                        user.role,
                        user.management_fee ?? null,
                        user.ib_account || null,
                        user.phone || null,
                        user.avatar_url || null,
                        user.initial_cost || 0,
                        user.initial_cash ?? 0,
                        user.initial_management_fee ?? 0,
                        user.initial_deposit ?? 0,
                        user.start_date || null,
                        user.fee_exempt_months ?? 0,
                        targetYear
                    ).run();
                    targetUserId = meta.last_row_id;
                    imported++;
                }



                // Import nested net equity records
                if (user.net_equity_records && Array.isArray(user.net_equity_records) && targetUserId) {
                    for (const record of user.net_equity_records) {
                        if (!record.date || record.net_equity === undefined) continue;

                        const recordYear = record.year || targetYear;

                        // Parse date if string
                        let dateTimestamp: number;
                        if (typeof record.date === 'string') {
                            dateTimestamp = Math.floor(new Date(record.date).getTime() / 1000);
                        } else {
                            dateTimestamp = record.date;
                        }

                        // Check duplicate record (user_id + date + year)
                        const existingRecord = await db.prepare(
                            `SELECT id FROM DAILY_NET_EQUITY 
                             WHERE user_id = ? AND date = ? AND year = ?`
                        ).bind(targetUserId, dateTimestamp, recordYear).first();

                        if (!existingRecord) {
                            try {
                                await db.prepare(
                                    `INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, management_fee, interest, exposure_adjustment, year, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    dateTimestamp,
                                    record.net_equity,
                                    record.cash_balance ?? 0,
                                    record.deposit ?? 0,
                                    record.management_fee ?? 0,
                                    record.daily_interest ?? record.interest ?? 0,
                                    record.exposure_adjustment || 'none',
                                    recordYear
                                ).run();
                            } catch (netErr) {
                                console.error(`Failed to import net equity record for user ${user.email}:`, netErr);
                            }
                        }
                    }
                }

                // Import nested deposits (Legacy support: Merge into DAILY_NET_EQUITY)
                // This handles backward compatibility for old backups that have separate 'deposits' array.
                if (user.deposits && Array.isArray(user.deposits) && user.deposits.length > 0 && targetUserId) {
                    for (const deposit of user.deposits) {
                        if (!deposit.deposit_date || deposit.amount === undefined) continue;

                        const depositYear = deposit.year || targetYear;
                        const transactionType = deposit.transaction_type || 'deposit';
                        // Signed amount: withdrawal is negative
                        const amount = transactionType === 'deposit' ? deposit.amount : -Math.abs(deposit.amount);

                        // Check if DAILY_NET_EQUITY record exists for this date
                        const existingRecord = await db.prepare(
                            `SELECT id FROM DAILY_NET_EQUITY WHERE user_id = ? AND date = ?`
                        ).bind(targetUserId, deposit.deposit_date).first();

                        if (existingRecord) {
                            // Update existing record
                            // We add to the existing deposit value to support multiple legacy deposits on same day being merged
                            try {
                                await db.prepare(
                                    `UPDATE DAILY_NET_EQUITY 
                                     SET deposit = deposit + ?, updated_at = unixepoch()
                                     WHERE id = ?`
                                ).bind(amount, existingRecord.id).run();
                            } catch (err) {
                                console.error(`Failed to merge legacy deposit for user ${user.email}:`, err);
                            }
                        } else {
                            // Insert new record
                            // If no net_equity record exists, we create one with 0 net_equity/cash_balance just to hold the deposit?
                            // Or should we infer something? Safer to just init with 0 and strict year.
                            try {
                                await db.prepare(
                                    `INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, management_fee, year, created_at, updated_at)
                                     VALUES (?, ?, 0, 0, ?, 0, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    deposit.deposit_date,
                                    amount,
                                    depositYear
                                ).run();
                            } catch (err) {
                                console.error(`Failed to insert legacy deposit record for user ${user.email}:`, err);
                            }
                        }
                    }
                }

                // Import nested options trading records
                // Create ID mapping: old option ID -> new option ID
                const optionIdMap = new Map<number, number>();
                if (user.options && Array.isArray(user.options) && targetUserId) {
                    for (const option of user.options) {
                        if (!option.open_date || !option.underlying || !option.type) continue;

                        const optionYear = option.year || targetYear;

                        // Check duplicate option (user, open_date, underlying, type, strike_price)
                        const existingOption = await db.prepare(
                            `SELECT id FROM OPTIONS 
                             WHERE owner_id = ? AND open_date = ? AND underlying = ? AND type = ? AND strike_price = ?`
                        ).bind(targetUserId, option.open_date, option.underlying, option.type, option.strike_price || 0).first();

                        if (!existingOption) {
                            try {
                                // Generate code if not present
                                let code = option.code || generateCode();

                                // Ensure code is unique across both OPTIONS and STOCK_TRADES
                                let isUnique = false;
                                let attempts = 0;
                                while (!isUnique && attempts < 10) {
                                    const [existingOptionCode, existingStockCode] = await Promise.all([
                                        db.prepare('SELECT id FROM OPTIONS WHERE code = ?').bind(code).first(),
                                        db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first()
                                    ]);

                                    if (!existingOptionCode && !existingStockCode) {
                                        isUnique = true;
                                    } else {
                                        code = generateCode();
                                        attempts++;
                                    }
                                }

                                const optionResult = await db.prepare(
                                    `INSERT INTO OPTIONS (
                                        owner_id, user_id, status, operation, open_date, to_date, settlement_date,
                                        days_to_expire, days_held,
                                        quantity, underlying, type, strike_price, collateral, premium,
                                        final_profit, profit_percent, delta, iv, capital_efficiency, code, year,
                                        created_at, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    user.user_id || null,  // Add user_id from the imported user data
                                    option.status || '未平倉',
                                    option.operation || null,
                                    option.open_date,
                                    option.to_date || null,
                                    option.settlement_date || null,
                                    option.days_to_expire ?? null,
                                    option.days_held ?? null,
                                    option.quantity || 0,
                                    option.underlying,
                                    option.type,
                                    option.strike_price || 0,
                                    option.collateral || null,
                                    option.premium || null,
                                    option.final_profit || null,
                                    option.profit_percent || null,
                                    option.delta || null,
                                    option.iv || null,
                                    option.capital_efficiency || null,
                                    code,
                                    optionYear
                                ).run();

                                // Store mapping: old option id -> new option id
                                if (option.id && optionResult.meta?.last_row_id) {
                                    optionIdMap.set(option.id, optionResult.meta.last_row_id as number);
                                }
                            } catch (optErr) {
                                console.error(`Failed to import option for user ${user.email}:`, optErr);
                            }
                        } else if (option.id) {
                            // Map old ID to existing ID for strategy linking
                            optionIdMap.set(option.id, existingOption.id as number);
                        }
                    }
                }

                // Import nested stock trades
                // Create ID mapping: old stock ID -> new stock ID
                const stockIdMap = new Map<number, number>();
                if (user.stock_trades && Array.isArray(user.stock_trades) && targetUserId) {
                    for (const trade of user.stock_trades) {
                        if (!trade.open_date || !trade.symbol || !trade.quantity) continue;

                        const tradeYear = trade.year || targetYear;

                        // Check duplicate stock trade (user, symbol, open_date, quantity)
                        // Removed open_price from check to avoid floating point mismatch issues
                        const existingTrade = await db.prepare(
                            `SELECT id FROM STOCK_TRADES 
                             WHERE owner_id = ? AND symbol = ? AND open_date = ? AND quantity = ?`
                        ).bind(targetUserId, trade.symbol, trade.open_date, trade.quantity).first();

                        if (!existingTrade) {
                            try {
                                // Generate code if not present
                                let code = trade.code || generateCode();

                                // Ensure code is unique across both OPTIONS and STOCK_TRADES
                                let isUnique = false;
                                let attempts = 0;
                                while (!isUnique && attempts < 10) {
                                    const [existingOptionCode, existingStockCode] = await Promise.all([
                                        db.prepare('SELECT id FROM OPTIONS WHERE code = ?').bind(code).first(),
                                        db.prepare('SELECT id FROM STOCK_TRADES WHERE code = ?').bind(code).first()
                                    ]);

                                    if (!existingOptionCode && !existingStockCode) {
                                        isUnique = true;
                                    } else {
                                        code = generateCode();
                                        attempts++;
                                    }
                                }

                                const stockResult = await db.prepare(
                                    `INSERT INTO STOCK_TRADES (
                                        owner_id, user_id, symbol, status, open_date, close_date, 
                                        open_price, close_price, quantity, code, year, source, close_source, created_at, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    user.user_id || null, // API uses string ID
                                    trade.symbol,
                                    trade.status || 'Open',
                                    trade.open_date,
                                    trade.close_date || null,
                                    trade.open_price,
                                    trade.close_price || null,
                                    trade.quantity,
                                    code,
                                    tradeYear,
                                    trade.source || null,
                                    trade.close_source || null
                                ).run();

                                // Store mapping: old stock id -> new stock id
                                if (trade.id && stockResult.meta?.last_row_id) {
                                    stockIdMap.set(trade.id, stockResult.meta.last_row_id as number);
                                }
                            } catch (stockErr) {
                                console.error(`Failed to import stock trade for user ${user.email}:`, stockErr);
                            }
                        } else if (trade.id) {
                            // Map old ID to existing ID for strategy linking
                            stockIdMap.set(trade.id, existingTrade.id as number);
                        }
                    }
                }

                // Import strategies
                if (user.strategies && Array.isArray(user.strategies) && targetUserId) {
                    for (const strategy of user.strategies) {
                        if (!strategy.name) continue;

                        const strategyYear = strategy.year || targetYear;

                        // Check duplicate strategy (same name, user, year)
                        const existingStrategy = await db.prepare(
                            `SELECT id FROM STRATEGIES WHERE owner_id = ? AND name = ? AND year = ?`
                        ).bind(targetUserId, strategy.name, strategyYear).first();

                        if (!existingStrategy) {
                            try {
                                // Create strategy
                                const strategyResult = await db.prepare(
                                    `INSERT INTO STRATEGIES (name, user_id, owner_id, year, status, option_strategy, stock_strategy, stock_strategy_params, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    strategy.name,
                                    strategy.user_id || user.user_id || null,
                                    targetUserId,
                                    strategyYear,
                                    strategy.status || '進行中',
                                    strategy.option_strategy || null,
                                    strategy.stock_strategy || null,
                                    strategy.stock_strategy_params || null
                                ).run();

                                const newStrategyId = strategyResult.meta.last_row_id;

                                // Link stock trades
                                if (strategy.stock_trade_ids && Array.isArray(strategy.stock_trade_ids)) {
                                    for (const oldStockId of strategy.stock_trade_ids) {
                                        const newStockId = stockIdMap.get(oldStockId);
                                        if (newStockId) {
                                            try {
                                                await db.prepare(
                                                    `INSERT INTO STRATEGY_STOCKS (strategy_id, stock_trade_id)
                                                     VALUES (?, ?)`
                                                ).bind(newStrategyId, newStockId).run();
                                            } catch (linkErr) {
                                                console.error(`Failed to link stock to strategy for user ${user.email}:`, linkErr);
                                            }
                                        }
                                    }
                                }

                                // Link options
                                if (strategy.option_ids && Array.isArray(strategy.option_ids)) {
                                    for (const oldOptionId of strategy.option_ids) {
                                        const newOptionId = optionIdMap.get(oldOptionId);
                                        if (newOptionId) {
                                            try {
                                                await db.prepare(
                                                    `INSERT INTO STRATEGY_OPTIONS (strategy_id, option_id)
                                                     VALUES (?, ?)`
                                                ).bind(newStrategyId, newOptionId).run();
                                            } catch (linkErr) {
                                                console.error(`Failed to link option to strategy for user ${user.email}:`, linkErr);
                                            }
                                        }
                                    }
                                }
                            } catch (stratErr) {
                                console.error(`Failed to import strategy for user ${user.email}:`, stratErr);
                            }
                        }
                    }
                }


                // Import nested monthly interest
                if (user.monthly_interest && Array.isArray(user.monthly_interest) && targetUserId) {
                    for (const interest of user.monthly_interest) {
                        if (interest.year === undefined || interest.month === undefined || interest.interest === undefined) continue;

                        // Check duplicate
                        const existingInterest = await db.prepare(
                            `SELECT year FROM monthly_interest WHERE user_id = ? AND year = ? AND month = ?`
                        ).bind(targetUserId, interest.year, interest.month).first();

                        if (!existingInterest) {
                            try {
                                await db.prepare(
                                    `INSERT INTO monthly_interest (user_id, year, month, interest, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(targetUserId, interest.year, interest.month, interest.interest).run();
                            } catch (intErr) {
                                console.error(`Failed to import monthly interest for user ${user.email}:`, intErr);
                            }
                        }
                    }
                }

                // Import monthly_fees
                if (user.monthly_fees && Array.isArray(user.monthly_fees) && targetUserId) {
                    for (const fee of user.monthly_fees) {
                        if (fee.year === undefined || fee.month === undefined || fee.amount === undefined) continue;

                        const existingFee = await db.prepare(
                            `SELECT user_id FROM monthly_fees WHERE user_id = ? AND year = ? AND month = ?`
                        ).bind(targetUserId, fee.year, fee.month).first();

                        if (!existingFee) {
                            try {
                                await db.prepare(
                                    `INSERT INTO monthly_fees (user_id, year, month, amount, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(targetUserId, fee.year, fee.month, fee.amount).run();
                            } catch (feeErr) {
                                console.error(`Failed to import monthly fee for user ${user.email}:`, feeErr);
                            }
                        }
                    }
                }
            } catch (error: any) {
                errors.push(`匯入失敗 (${user.user_id || user.email}): ${error.message}`);
                skipped++;
            }
        }

        // Import market prices (Benchmark data) - Batch Processing
        let importedPrices = 0;
        if (market_prices && Array.isArray(market_prices)) {
            // Chunk size for batching (D1 has limits on batch size and statement count)
            // Cloudflare D1 batch size limit is usually around 128 or related to SQL size. 
            // 50 is a safe conservative number.
            const BATCH_SIZE = 50;

            // Filter valid prices first
            const validPrices = market_prices.filter(p => p.symbol && p.date && p.close_price !== undefined);

            for (let i = 0; i < validPrices.length; i += BATCH_SIZE) {
                const chunk = validPrices.slice(i, i + BATCH_SIZE);
                const batch = [];

                // Prepare statement for reuse
                const stmt = db.prepare(
                    `INSERT OR IGNORE INTO market_prices (symbol, date, close_price, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                );

                for (const price of chunk) {
                    batch.push(stmt.bind(price.symbol, price.date, price.close_price, price.open ?? null, price.high ?? null, price.low ?? null, price.close ?? null, price.volume ?? null));
                }

                if (batch.length > 0) {
                    try {
                        const results = await db.batch(batch);
                        // Count successful inserts? 
                        // db.batch returns array of results. success is true for all if no throw?
                        // INSERT OR IGNORE returns changes: 0 if ignored, 1 if inserted.
                        // We can sum up 'changes' if available, or just assume chunk size for simplicity of tracking processed.
                        // Let's count actual changes if possible.
                        if (Array.isArray(results)) {
                            // D1 result type is { results: [], success: boolean, meta: { changed_db: boolean, changes: number, ... } }
                            // But depending on driver version it might vary.
                            // Safest is to just count processed.
                            importedPrices += batch.length;
                        }
                    } catch (batchErr) {
                        console.error(`Failed to import market prices batch starting at index ${i}:`, batchErr);
                        errors.push(`Benchmark data batch import failed at index ${i}`);
                    }
                }
            }
        }

        // Import annotations (top-level, not user-scoped)
        let importedAnnotations = 0;
        if (importAnnotations && Array.isArray(importAnnotations)) {
            for (const ann of importAnnotations) {
                try {
                    const annYear = ann.year || (targetYear ? parseInt(targetYear as string) : new Date().getFullYear());
                    const desc = ann.description || null;

                    // Check for duplicate: same year + description + same items
                    const itemSymbols = (ann.items || []).map((i: any) => i.symbol).sort().join(',');
                    const { results: existingAnns } = await db.prepare(
                        'SELECT id FROM ANNOTATIONS WHERE year = ? AND (description = ? OR (description IS NULL AND ? IS NULL))'
                    ).bind(annYear, desc, desc).all();

                    let isDuplicate = false;
                    for (const existing of (existingAnns || [])) {
                        const { results: existingItems } = await db.prepare(
                            'SELECT symbol FROM ANNOTATION_ITEMS WHERE annotation_id = ? ORDER BY symbol'
                        ).bind(existing.id).all();
                        const existingSymbols = (existingItems || []).map((i: any) => i.symbol).sort().join(',');
                        if (existingSymbols === itemSymbols) {
                            isDuplicate = true;
                            break;
                        }
                    }

                    if (isDuplicate) continue;

                    // Insert annotation - remap owner_id from first owner
                    const firstOwner = ann.owners?.[0];
                    let annOwnerId = null;
                    if (firstOwner?.user_id) {
                        const matchedUser = await db.prepare(
                            'SELECT id FROM USERS WHERE user_id = ? LIMIT 1'
                        ).bind(firstOwner.user_id).first();
                        if (matchedUser) {
                            annOwnerId = matchedUser.id;
                        }
                    }
                    const annResult = await db.prepare(
                        `INSERT INTO ANNOTATIONS (user_id, owner_id, year, description, created_at, updated_at)
                         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
                    ).bind(firstOwner?.user_id || null, annOwnerId, annYear, desc).run();

                    const newAnnId = annResult.meta.last_row_id as number;

                    // Insert items
                    if (ann.items && Array.isArray(ann.items)) {
                        for (const item of ann.items) {
                            if (!item.symbol) continue;
                            await db.prepare(
                                'INSERT INTO ANNOTATION_ITEMS (annotation_id, symbol) VALUES (?, ?)'
                            ).bind(newAnnId, item.symbol).run();
                        }
                    }

                    // Insert owners - remap owner_id by looking up user_id in new DB
                    if (ann.owners && Array.isArray(ann.owners)) {
                        for (const owner of ann.owners) {
                            let newOwnerId = owner.owner_id || null;
                            // Remap owner_id: look up user by user_id string to get new DB id
                            if (owner.user_id) {
                                const matchedUser = await db.prepare(
                                    'SELECT id FROM USERS WHERE user_id = ? LIMIT 1'
                                ).bind(owner.user_id).first();
                                if (matchedUser) {
                                    newOwnerId = matchedUser.id;
                                }
                            }
                            try {
                                await db.prepare(
                                    'INSERT INTO ANNOTATION_OWNERS (annotation_id, owner_id, user_id) VALUES (?, ?, ?)'
                                ).bind(newAnnId, newOwnerId, owner.user_id || null).run();
                            } catch (ownerErr) {
                                console.error('Failed to import annotation owner:', ownerErr);
                            }
                        }
                    }

                    importedAnnotations++;
                } catch (annErr) {
                    console.error('Failed to import annotation:', annErr);
                }
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            updated,
            skipped,
            imported_market_prices: importedPrices,
            imported_annotations: importedAnnotations,
            total: users.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
