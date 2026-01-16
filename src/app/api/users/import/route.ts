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
}

// POST: Import users from JSON array
export async function POST(req: NextRequest) {
    try {
        const admin = await checkAdmin(req);
        if (!admin) {
            return NextResponse.json({ error: '權限不足' }, { status: 403 });
        }

        const body = await req.json();
        const { users } = body;

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

                // Check if user already exists
                const existing = await db.prepare(
                    `SELECT id FROM USERS WHERE (email = ? OR (user_id IS NOT NULL AND user_id = ?)) AND year = ?`
                ).bind(user.email, user.user_id || null, targetYear).first();

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

                // Import nested deposits
                if (user.deposits && Array.isArray(user.deposits) && targetUserId) {
                    for (const deposit of user.deposits) {
                        if (!deposit.deposit_date || deposit.amount === undefined) continue;

                        const depositYear = deposit.year || targetYear;
                        const depositType = deposit.deposit_type || 'cash';
                        const transType = deposit.transaction_type || 'deposit';

                        // Check duplicate deposit
                        const existingDeposit = await db.prepare(
                            `SELECT id FROM DEPOSITS 
                             WHERE user_id = ? AND deposit_date = ? AND amount = ? AND transaction_type = ? AND year = ?`
                        ).bind(targetUserId, deposit.deposit_date, deposit.amount, transType, depositYear).first();

                        if (!existingDeposit) {
                            try {
                                await db.prepare(
                                    `INSERT INTO DEPOSITS (deposit_date, user_id, amount, year, note, deposit_type, transaction_type, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    deposit.deposit_date,
                                    targetUserId,
                                    deposit.amount,
                                    depositYear,
                                    deposit.note || null,
                                    depositType,
                                    transType
                                ).run();
                            } catch (depErr) {
                                console.error(`Failed to import deposit for user ${user.email}:`, depErr);
                            }
                        }
                    }
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
                                    `INSERT INTO DAILY_NET_EQUITY (user_id, date, net_equity, year, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
                                    dateTimestamp,
                                    record.net_equity,
                                    recordYear
                                ).run();
                            } catch (netErr) {
                                console.error(`Failed to import net equity record for user ${user.email}:`, netErr);
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
                                        owner_id, status, operation, open_date, to_date, settlement_date,
                                        quantity, underlying, type, strike_price, collateral, premium,
                                        final_profit, profit_percent, delta, iv, capital_efficiency, year,
                                        created_at, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
                                ).bind(
                                    targetUserId,
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


            } catch (error: any) {
                errors.push(`匯入失敗 (${user.user_id || user.email}): ${error.message}`);
                skipped++;
            }
        }

        return NextResponse.json({
            success: true,
            imported,
            updated,
            skipped,
            total: users.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import users error:', error);
        return NextResponse.json({ error: '伺服器內部錯誤' }, { status: 500 });
    }
}
