import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';

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
    year?: number | null;
    deposits?: any[];
    net_equity_records?: any[];
    options?: any[];
    monthly_interest?: any[];
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
        const { users, market_prices, sourceYear } = body;

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

        const db = await getDb();
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
                         role = ?, management_fee = ?, ib_account = ?, phone = ?, avatar_url = ?, initial_cost = ?, updated_at = unixepoch()
                         WHERE id = ?`
                    ).bind(
                        user.role,
                        user.management_fee ?? null,
                        user.ib_account || null,
                        user.phone || null,
                        user.avatar_url || null,
                        user.initial_cost || 0,
                        existing.id
                    ).run();
                    updated++;
                } else {
                    // Insert new user
                    const { meta } = await db.prepare(
                        `INSERT INTO USERS (user_id, email, password, role, management_fee, ib_account, phone, avatar_url, initial_cost, year, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
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
                                    `INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, year, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    dateTimestamp,
                                    record.net_equity,
                                    record.cash_balance ?? 0,
                                    record.deposit ?? 0,
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
                                    `INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, cash_balance, deposit, year, created_at, updated_at)
                                     VALUES (?, ?, 0, 0, ?, ?, unixepoch(), unixepoch())`
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
                                await db.prepare(
                                    `INSERT INTO OPTIONS (
                                        owner_id, user_id, status, operation, open_date, to_date, settlement_date,
                                        quantity, underlying, type, strike_price, collateral, premium,
                                        final_profit, profit_percent, delta, iv, capital_efficiency, year,
                                        created_at, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    user.user_id || null,  // Add user_id from the imported user data
                                    option.status || '未平倉',
                                    option.operation || null,
                                    option.open_date,
                                    option.to_date || null,
                                    option.settlement_date || null,
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
                                    optionYear
                                ).run();
                            } catch (optErr) {
                                console.error(`Failed to import option for user ${user.email}:`, optErr);
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

                // Import nested monthly fee records
                if (user.monthly_fees && Array.isArray(user.monthly_fees) && targetUserId) {
                    for (const fee of user.monthly_fees) {
                        if (fee.year === undefined || fee.month === undefined || fee.amount === undefined) continue;

                        // Check duplicate
                        const existingFee = await db.prepare(
                            `SELECT year FROM monthly_fees WHERE user_id = ? AND year = ? AND month = ?`
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
                    `INSERT OR IGNORE INTO market_prices (symbol, date, close_price) VALUES (?, ?, ?)`
                );

                for (const price of chunk) {
                    batch.push(stmt.bind(price.symbol, price.date, price.close_price));
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

        return NextResponse.json({
            success: true,
            imported,
            updated,
            skipped,
            imported_market_prices: importedPrices,
            total: users.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
