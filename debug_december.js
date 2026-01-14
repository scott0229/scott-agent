
const { getDb } = require('./src/lib/db');

async function debugDecemberData() {
    try {
        const db = await getDb();

        // Find a user who has trades in December of any year (or let's just look at all December trades)
        // We'll target the current context year if possible, but let's just dump recent December trades.
        const query = `
            SELECT 
                id,
                owner_id,
                date(open_date, 'unixepoch') as open_date_str,
                collateral, 
                days_held, 
                open_date,
                to_date,
                settlement_date,
                status
            FROM OPTIONS 
            WHERE strftime('%m', datetime(open_date, 'unixepoch')) = '12'
            LIMIT 5;
        `;

        const { results } = await db.prepare(query).all();
        console.log('December Trades Sample:', JSON.stringify(results, null, 2));

        // Let's also verify if there are ANY trades with null days_held
        const nullDaysQuery = `
            SELECT COUNT(*) as count 
            FROM OPTIONS 
            WHERE days_held IS NULL OR days_held = 0;
        `;
        const { results: nullStats } = await db.prepare(nullDaysQuery).all();
        console.log('Trades with NULL/0 days_held:', nullStats);

    } catch (error) {
        console.error('Error:', error);
    }
}

debugDecemberData();
