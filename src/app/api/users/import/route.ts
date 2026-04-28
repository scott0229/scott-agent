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
    monthly_fees?: any[];
    trade_groups?: any[];
    password?: string;
    name?: string | null;
    api_key?: string | null;
    initial_interest?: number | null;
    auto_update_time?: string | null;
    last_auto_update_time?: number | null;
    last_auto_update_status?: string | null;
    last_auto_update_message?: string | null;
    created_at?: number;
    updated_at?: number;
}

// POST: Import users from JSON array
export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const body = await req.json();
        const { users, market_prices, annotations: importAnnotations, trader_settings, report_archives, sourceYear } = body;

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
        // Lazy-init: only hash password if we actually need to create a new user
        let passwordHash: string | null = null;

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
                         role = ?, management_fee = ?, ib_account = ?, phone = ?, avatar_url = ?, initial_cost = ?, initial_cash = ?, initial_management_fee = ?, initial_deposit = ?, start_date = ?, fee_exempt_months = ?, account_capability = ?, operation_mode = ?, name = ?, api_key = ?, initial_interest = ?, auto_update_time = ?, last_auto_update_time = ?, last_auto_update_status = ?, last_auto_update_message = ?, updated_at = unixepoch()
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
                        (user as any).account_capability || null,
                        (user as any).operation_mode || null,
                        user.name || null,
                        user.api_key || null,
                        user.initial_interest ?? 0,
                        user.auto_update_time || '06:00',
                        user.last_auto_update_time ?? null,
                        user.last_auto_update_status || null,
                        user.last_auto_update_message || null,
                        existing.id
                    ).run();
                    updated++;
                } else {
                    // Only hash password once, when first new user needs it
                    if (!passwordHash) {
                        passwordHash = await bcrypt.hash(defaultPassword, 10);
                    }
                    const userPassword = user.password || passwordHash;
                    const createdAt = user.created_at || Math.floor(Date.now() / 1000);
                    const updatedAt = user.updated_at || Math.floor(Date.now() / 1000);

                    // Insert new user
                    const { meta } = await db.prepare(
                        `INSERT INTO USERS (user_id, email, password, role, management_fee, ib_account, phone, avatar_url, initial_cost, initial_cash, initial_management_fee, initial_deposit, start_date, fee_exempt_months, account_capability, operation_mode, name, api_key, initial_interest, auto_update_time, last_auto_update_time, last_auto_update_status, last_auto_update_message, year, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        user.user_id || null,
                        user.email,
                        userPassword,
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
                        (user as any).account_capability || null,
                        (user as any).operation_mode || null,
                        user.name || null,
                        user.api_key || null,
                        user.initial_interest ?? 0,
                        user.auto_update_time || '06:00',
                        user.last_auto_update_time ?? null,
                        user.last_auto_update_status || null,
                        user.last_auto_update_message || null,
                        targetYear,
                        createdAt,
                        updatedAt
                    ).run();
                    targetUserId = meta.last_row_id;
                    imported++;
                }



                // Import nested net equity records (batched INSERT OR IGNORE)
                if (user.net_equity_records && Array.isArray(user.net_equity_records) && targetUserId) {
                    const validRecords = user.net_equity_records.filter((r: any) => r.date && r.net_equity !== undefined);
                    const NE_BATCH = 20;
                    for (let b = 0; b < validRecords.length; b += NE_BATCH) {
                        const batch = validRecords.slice(b, b + NE_BATCH);
                        const stmts = batch.map((record: any) => {
                            const recordYear = record.year || targetYear;
                            let dateTimestamp: number;
                            if (typeof record.date === 'string') {
                                dateTimestamp = Math.floor(new Date(record.date).getTime() / 1000);
                            } else {
                                dateTimestamp = record.date;
                            }
                            return db.prepare(
                                `INSERT OR IGNORE INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, management_fee, interest, exposure_adjustment, year, created_at, updated_at)
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
                            );
                        });
                        try {
                            // Only batch if we have statements
                            if (stmts.length > 0) {
                                await db.batch(stmts);
                            }
                        } catch (netErr) {
                            console.error(`Failed to batch import net equity for user ${user.email}:`, netErr);
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

                // Import trade groups first, so we can map their IDs for options and stocks
                const groupIdMap = new Map<number, number>();
                const existingGroupMap = new Map<string, number>();
                if (user.trade_groups && Array.isArray(user.trade_groups) && targetUserId) {
                    // Pre-fetch all existing groups for this user to avoid sequential SELECTs
                    const existingGroupsRes = await db.prepare(
                        `SELECT id, year, name FROM TRADE_GROUPS WHERE owner_id = ?`
                    ).bind(targetUserId).all();
                    for (const g of (existingGroupsRes.results || [])) {
                        existingGroupMap.set(`${g.year}-${g.name}`, g.id as number);
                    }

                    const updateStmts = [];

                    for (const group of user.trade_groups) {
                        if (!group.name || group.year === undefined) continue;

                        try {
                            const groupYear = group.year || targetYear;
                            const key = `${groupYear}-${group.name}`;
                            let newGroupId = existingGroupMap.get(key);
                            
                            if (newGroupId) {
                                // Add to batch updates instead of sequential await
                                updateStmts.push(
                                    db.prepare(
                                        `UPDATE TRADE_GROUPS SET 
                                         status = ?, note = ?, note_color = ?, next_group = ?, updated_at = ?
                                         WHERE id = ?`
                                    ).bind(
                                        group.status || 'Active', 
                                        group.note || null, 
                                        group.note_color || null, 
                                        group.next_group || null, 
                                        group.updated_at || Math.floor(Date.now() / 1000),
                                        newGroupId
                                    )
                                );
                            } else {
                                // Insert sequentially only for new groups (usually only happens in the first chunk)
                                const result = await db.prepare(
                                    `INSERT INTO TRADE_GROUPS (owner_id, year, name, status, note, note_color, next_group, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                                ).bind(
                                    targetUserId, 
                                    groupYear, 
                                    group.name, 
                                    group.status || 'Active', 
                                    group.note || null, 
                                    group.note_color || null, 
                                    group.next_group || null, 
                                    group.created_at || Math.floor(Date.now() / 1000), 
                                    group.updated_at || Math.floor(Date.now() / 1000)
                                ).run();
                                newGroupId = result.meta.last_row_id as number;
                                existingGroupMap.set(key, newGroupId);
                            }
                            
                            if (group.id && newGroupId) {
                                groupIdMap.set(Number(group.id), newGroupId);
                            }
                        } catch (grpErr) {
                            console.error(`Failed to import trade group for user ${user.email}:`, grpErr);
                        }
                    }

                    // Execute updates in batches
                    if (updateStmts.length > 0) {
                        try {
                            const BATCH_SIZE = 50;
                            for (let i = 0; i < updateStmts.length; i += BATCH_SIZE) {
                                await db.batch(updateStmts.slice(i, i + BATCH_SIZE));
                            }
                        } catch (err) {
                            console.error(`Failed to batch update trade groups for user ${user.email}:`, err);
                        }
                    }
                }

                // Import nested options trading records
                // Create ID mapping: old option ID -> new option ID
                const optionIdMap = new Map<number, number>();
                if (user.options && Array.isArray(user.options) && targetUserId) {
                    // Pre-fetch all existing options for this user in ONE query
                    const existingOptions = await db.prepare(
                        `SELECT id, open_date, underlying, type, strike_price FROM OPTIONS WHERE owner_id = ?`
                    ).bind(targetUserId).all();
                    const existingSet = new Set(
                        (existingOptions.results || []).map((o: any) =>
                            `${o.open_date}|${o.underlying}|${o.type}|${o.strike_price}`
                        )
                    );
                    // Build map of existing options for ID mapping
                    const existingMap = new Map<string, number>();
                    for (const o of (existingOptions.results || []) as any[]) {
                        existingMap.set(`${o.open_date}|${o.underlying}|${o.type}|${o.strike_price}`, o.id);
                    }

                    const updateOptionStmts: any[] = [];
                    // Filter new options and batch insert
                    const newOptions = user.options.filter((option: any) => {
                        if (!option.open_date || !option.underlying || !option.type) return false;
                        const key = `${option.open_date}|${option.underlying}|${option.type}|${option.strike_price || 0}`;
                        if (existingSet.has(key)) {
                            const existingId = existingMap.get(key)!;
                            if (option.id) {
                                optionIdMap.set(option.id, existingId);
                            }
                            // Update group_id for existing options (fixes cases where options were imported before trade groups)
                            let mappedGroupId = null;
                            if (option.group_id) {
                                if (typeof option.group_id === 'number' || !isNaN(Number(option.group_id))) {
                                    mappedGroupId = groupIdMap.get(Number(option.group_id)) || null;
                                } else {
                                    mappedGroupId = existingGroupMap.get(`${option.year || targetYear}-${String(option.group_id).trim()}`) || null;
                                }
                            }
                            
                            let mappedCloseGroupId = null;
                            if (option.close_group_id) {
                                if (typeof option.close_group_id === 'number' || !isNaN(Number(option.close_group_id))) {
                                    mappedCloseGroupId = groupIdMap.get(Number(option.close_group_id)) || null;
                                } else {
                                    mappedCloseGroupId = existingGroupMap.get(`${option.year || targetYear}-${String(option.close_group_id).trim()}`) || null;
                                }
                            }
                            if (mappedGroupId) {
                                updateOptionStmts.push(
                                    db.prepare(`UPDATE OPTIONS SET group_id = COALESCE(?, group_id) WHERE id = ?`)
                                    .bind(mappedGroupId, existingId)
                                );
                            }
                            
                            return false;
                        }
                        return true;
                    });

                    // Batch INSERT all new options in chunked db.batch() calls
                    if (newOptions.length > 0) {
                        const stmts = newOptions.map((option: any) => {
                            const code = option.code || generateCode();
                            const optionYear = option.year || targetYear;
                            const createdAt = option.created_at || Math.floor(Date.now() / 1000);
                            const updatedAt = option.updated_at || Math.floor(Date.now() / 1000);
                            
                            let mappedGroupId = null;
                            if (option.group_id) {
                                if (typeof option.group_id === 'number' || !isNaN(Number(option.group_id))) {
                                    mappedGroupId = groupIdMap.get(Number(option.group_id)) || null;
                                } else {
                                    mappedGroupId = existingGroupMap.get(`${optionYear}-${String(option.group_id).trim()}`) || null;
                                }
                            }
                            
                            return db.prepare(
                                `INSERT INTO OPTIONS (
                                    owner_id, user_id, status, operation, open_date, to_date, settlement_date,
                                    days_to_expire, days_held,
                                    quantity, underlying, type, strike_price, collateral, premium,
                                    final_profit, profit_percent, delta, iv, capital_efficiency, code, year, underlying_price,
                                    note, note_color, has_separator, group_id, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                            ).bind(
                                targetUserId,
                                user.user_id || null,
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
                                optionYear,
                                option.underlying_price ?? null,
                                option.note || null,
                                option.note_color || null,
                                option.has_separator ? 1 : 0,
                                mappedGroupId || null,
                                createdAt,
                                updatedAt
                            );
                        });

                        try {
                            // Chunk size of 50 to avoid Cloudflare D1 batch limit
                            const BATCH_SIZE = 50;
                            for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
                                const chunkStmts = stmts.slice(i, i + BATCH_SIZE);
                                const chunkOptions = newOptions.slice(i, i + BATCH_SIZE);
                                const results = await db.batch(chunkStmts);
                                
                                // Map old IDs to new IDs for strategy linking
                                for (let r = 0; r < results.length; r++) {
                                    const option = chunkOptions[r];
                                    const newId = results[r]?.meta?.last_row_id;
                                    if (option.id && newId) {
                                        optionIdMap.set(option.id, newId as number);
                                    }
                                }
                            }
                        } catch (optErr) {
                            console.error(`Failed to batch import options for user ${user.email}:`, optErr);
                            errors.push(`期權批次匯入失敗 (${user.user_id || user.email})`);
                        }
                    }

                    // Batch UPDATE existing options
                    if (updateOptionStmts.length > 0) {
                        try {
                            const BATCH_SIZE = 50;
                            for (let i = 0; i < updateOptionStmts.length; i += BATCH_SIZE) {
                                await db.batch(updateOptionStmts.slice(i, i + BATCH_SIZE));
                            }
                        } catch (optUpdateErr) {
                            console.error(`Failed to batch update existing options for user ${user.email}:`, optUpdateErr);
                        }
                    }
                }

                // Import nested stock trades
                // Create ID mapping: old stock ID -> new stock ID
                const stockIdMap = new Map<number, number>();
                if (user.stock_trades && Array.isArray(user.stock_trades) && targetUserId) {
                    // Pre-fetch all existing stock trades for this user in ONE query
                    const existingStocks = await db.prepare(
                        `SELECT id, symbol, open_date, quantity FROM STOCK_TRADES WHERE owner_id = ?`
                    ).bind(targetUserId).all();
                    const existingStockSet = new Set(
                        (existingStocks.results || []).map((s: any) =>
                            `${s.symbol}|${s.open_date}|${s.quantity}`
                        )
                    );
                    const existingStockMap = new Map<string, number>();
                    for (const s of (existingStocks.results || []) as any[]) {
                        existingStockMap.set(`${s.symbol}|${s.open_date}|${s.quantity}`, s.id);
                    }

                    const updateStockStmts: any[] = [];
                    const newTrades = user.stock_trades.filter((trade: any) => {
                        if (!trade.open_date || !trade.symbol || !trade.quantity) return false;
                        const key = `${trade.symbol}|${trade.open_date}|${trade.quantity}`;
                        if (existingStockSet.has(key)) {
                            const existingId = existingStockMap.get(key)!;
                            if (trade.id) {
                                stockIdMap.set(trade.id, existingId);
                            }
                            
                            // Update group_id for existing stock trades
                            let mappedGroupId = null;
                            if (trade.group_id) {
                                if (typeof trade.group_id === 'number' || !isNaN(Number(trade.group_id))) {
                                    mappedGroupId = groupIdMap.get(Number(trade.group_id)) || null;
                                } else {
                                    mappedGroupId = existingGroupMap.get(`${trade.year || targetYear}-${String(trade.group_id).trim()}`) || null;
                                }
                            }
                            
                            let mappedCloseGroupId = null;
                            if (trade.close_group_id) {
                                if (typeof trade.close_group_id === 'number' || !isNaN(Number(trade.close_group_id))) {
                                    mappedCloseGroupId = groupIdMap.get(Number(trade.close_group_id)) || null;
                                } else {
                                    mappedCloseGroupId = existingGroupMap.get(`${trade.year || targetYear}-${String(trade.close_group_id).trim()}`) || null;
                                }
                            }
                            if (mappedGroupId || mappedCloseGroupId) {
                                updateStockStmts.push(
                                    db.prepare(`UPDATE STOCK_TRADES SET group_id = COALESCE(?, group_id), close_group_id = COALESCE(?, close_group_id) WHERE id = ?`)
                                    .bind(mappedGroupId || null, mappedCloseGroupId || null, existingId)
                                );
                            }
                            
                            return false;
                        }
                        return true;
                    });

                    // Batch INSERT all new trades in chunked db.batch() calls
                    if (newTrades.length > 0) {
                        const stmts = newTrades.map((trade: any) => {
                            const code = trade.code || generateCode();
                            const tradeYear = trade.year || targetYear;
                            const createdAt = trade.created_at || Math.floor(Date.now() / 1000);
                            const updatedAt = trade.updated_at || Math.floor(Date.now() / 1000);
                            
                            let mappedGroupId = null;
                            if (trade.group_id) {
                                if (typeof trade.group_id === 'number' || !isNaN(Number(trade.group_id))) {
                                    mappedGroupId = groupIdMap.get(Number(trade.group_id)) || null;
                                } else {
                                    mappedGroupId = existingGroupMap.get(`${tradeYear}-${String(trade.group_id).trim()}`) || null;
                                }
                            }
                            
                            let mappedCloseGroupId = null;
                            if (trade.close_group_id) {
                                if (typeof trade.close_group_id === 'number' || !isNaN(Number(trade.close_group_id))) {
                                    mappedCloseGroupId = groupIdMap.get(Number(trade.close_group_id)) || null;
                                } else {
                                    mappedCloseGroupId = existingGroupMap.get(`${tradeYear}-${String(trade.close_group_id).trim()}`) || null;
                                }
                            }
                            
                            return db.prepare(
                                `INSERT INTO STOCK_TRADES (
                                    owner_id, user_id, symbol, status, open_date, close_date, 
                                    open_price, close_price, quantity, code, year, source, close_source, 
                                    note, close_note, note_color, close_note_color, has_separator, close_has_separator, include_in_options, group_id, close_group_id, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                            ).bind(
                                targetUserId,
                                user.user_id || null,
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
                                trade.close_source || null,
                                trade.note || null,
                                trade.close_note || null,
                                trade.note_color || null,
                                trade.close_note_color || null,
                                trade.has_separator ? 1 : 0,
                                trade.close_has_separator ? 1 : 0,
                                trade.include_in_options ? 1 : 0,
                                mappedGroupId || null,
                                mappedCloseGroupId || null,
                                createdAt,
                                updatedAt
                            );
                        });

                        try {
                            const BATCH_SIZE = 50;
                            for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
                                const chunkStmts = stmts.slice(i, i + BATCH_SIZE);
                                const chunkTrades = newTrades.slice(i, i + BATCH_SIZE);
                                const results = await db.batch(chunkStmts);
                                for (let r = 0; r < results.length; r++) {
                                    const trade = chunkTrades[r];
                                    const newId = results[r]?.meta?.last_row_id;
                                    if (trade.id && newId) {
                                        stockIdMap.set(trade.id, newId as number);
                                    }
                                }
                            }
                        } catch (stockErr) {
                            console.error(`Failed to batch import stock trades for user ${user.email}:`, stockErr);
                            errors.push(`股票批次匯入失敗 (${user.user_id || user.email})`);
                        }
                    }

                    // Batch UPDATE existing stock trades
                    if (updateStockStmts.length > 0) {
                        try {
                            const BATCH_SIZE = 50;
                            for (let i = 0; i < updateStockStmts.length; i += BATCH_SIZE) {
                                await db.batch(updateStockStmts.slice(i, i + BATCH_SIZE));
                            }
                        } catch (stkUpdateErr) {
                            console.error(`Failed to batch update existing stock trades for user ${user.email}:`, stkUpdateErr);
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
            const BATCH_SIZE = 25;

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

        // Import trader_settings (Global)
        let importedTraderSettings = 0;
        if (trader_settings && Array.isArray(trader_settings)) {
            for (const setting of trader_settings) {
                if (!setting.key || !setting.value) continue;
                try {
                    await db.prepare(
                        'INSERT OR REPLACE INTO TRADER_SETTINGS (key, value, updated_at) VALUES (?, ?, ?)'
                    ).bind(setting.key, setting.value, setting.updated_at || Math.floor(Date.now() / 1000)).run();
                    importedTraderSettings++;
                } catch (err) {
                    console.error('Failed to import trader setting:', err);
                }
            }
        }

        // Import report_archives (Global)
        let importedReportArchives = 0;
        if (report_archives && Array.isArray(report_archives)) {
            for (const archive of report_archives) {
                if (!archive.filename || !archive.bucket_key || !archive.statement_date) continue;
                try {
                    // Check if exists
                    const existing = await db.prepare(
                        'SELECT id FROM report_archives WHERE filename = ? AND statement_date = ?'
                    ).bind(archive.filename, archive.statement_date).first();

                    if (!existing) {
                        await db.prepare(
                            'INSERT INTO report_archives (filename, bucket_key, statement_date, created_at) VALUES (?, ?, ?, ?)'
                        ).bind(archive.filename, archive.bucket_key, archive.statement_date, archive.created_at || Math.floor(Date.now() / 1000)).run();
                        importedReportArchives++;
                    }
                } catch (err) {
                    console.error('Failed to import report archive:', err);
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
            imported_trader_settings: importedTraderSettings,
            imported_report_archives: importedReportArchives,
            total: users.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
