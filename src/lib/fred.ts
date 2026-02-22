/**
 * FRED API Utility
 * Fetches Federal Funds Rate (FEDFUNDS) from St. Louis Fed FRED API.
 * Used to calculate estimated IB margin interest.
 *
 * API Key: aded63456fa78e80b7d339ec1e02fd2e
 * Series: FEDFUNDS (monthly, %)
 */

const FRED_API_KEY = 'aded63456fa78e80b7d339ec1e02fd2e';
const FRED_SERIES_ID = 'FEDFUNDS';

// In-memory cache: year -> { 'YYYY-MM': rate }
const rateCache = new Map<number, Record<string, number>>();

/**
 * Fetch all FEDFUNDS monthly rates for a given year.
 * Returns a map of 'YYYY-MM' -> rate (%)
 */
async function fetchFredRatesForYear(year: number): Promise<Record<string, number>> {
    const cached = rateCache.get(year);
    if (cached) return cached;

    const startDate = `${year - 1}-12-01`; // Fetch from prior Dec to cover Jan
    const endDate = `${year}-12-31`;

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${FRED_SERIES_ID}&api_key=${FRED_API_KEY}&observation_start=${startDate}&observation_end=${endDate}&file_type=json`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`FRED API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
        observations: Array<{ date: string; value: string }>;
    };

    const rateMap: Record<string, number> = {};
    for (const obs of data.observations) {
        const rate = parseFloat(obs.value);
        if (!isNaN(rate)) {
            // Key by YYYY-MM (e.g. '2026-01')
            const monthKey = obs.date.substring(0, 7);
            rateMap[monthKey] = rate;
        }
    }

    rateCache.set(year, rateMap);
    return rateMap;
}

/**
 * Get the FEDFUNDS rate for a specific Unix timestamp date.
 * Returns the rate in % (e.g. 3.64 for 3.64%).
 * Falls back to the previous available month if not found.
 */
export async function getFedFundsRate(dateUnix: number): Promise<number> {
    const date = new Date(dateUnix * 1000);
    const year = date.getFullYear();
    const rateMap = await fetchFredRatesForYear(year);

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;

    // Try current month first, then walk back up to 6 months
    for (let i = 0; i <= 6; i++) {
        const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (rateMap[key] !== undefined) {
            return rateMap[key];
        }
    }

    // Default fallback
    return 4.33;
}

/**
 * IB Pro blended spread based on loan amount (USD).
 * Returns spread in % (e.g. 1.5 for 1.5%).
 */
export function getIBProSpread(loanAmount: number): number {
    if (loanAmount <= 100_000) return 1.5;
    if (loanAmount <= 1_000_000) return 1.0;
    if (loanAmount <= 3_000_000) return 0.5;
    return 0.25;
}

/**
 * Calculate estimated daily IB margin interest for a given cash balance and date.
 * Returns a negative number (interest charge) or 0 if no margin loan.
 *
 * @param cashBalance  The account's cash balance (negative = margin loan)
 * @param dateUnix     Unix timestamp of the record date
 * @param rateMap      Pre-fetched rate map for efficiency (optional)
 */
export function calculateDailyInterest(
    cashBalance: number,
    dateUnix: number,
    rateMap: Record<string, number>
): number {
    if (cashBalance >= 0) return 0;

    const loanAmount = Math.abs(cashBalance);

    // Get the matching month key
    const date = new Date(dateUnix * 1000);
    let fedRate = 4.33; // fallback

    // Walk backwards up to 6 months to find a rate
    for (let i = 0; i <= 6; i++) {
        const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (rateMap[key] !== undefined) {
            fedRate = rateMap[key];
            break;
        }
    }

    const spread = getIBProSpread(loanAmount);
    const annualRate = (fedRate + spread) / 100;

    // IB uses 360-day convention
    const dailyInterest = loanAmount * annualRate / 360;

    return -dailyInterest; // Negative = expense
}

/**
 * Fetch rate map for a year (for batch processing in API routes).
 */
export { fetchFredRatesForYear };
