export interface MarketData {
    date: number; // Unix timestamp
    close: number;
}

export interface Deposit {
    deposit_date: number;
    amount: number;
    transaction_type: string;
}

export interface EquityRecord {
    date: number;
    net_equity: number;
}

export interface TWRResult {
    startEquity: number;
    currentEquity: number;
    returnPercentage: number;
    maxDrawdown: number;
    annualizedReturn: number;
    annualizedStdDev: number;
    sharpeRatio: number;
    newHighCount: number;
    newHighFreq: number;
    dailyReturns: number[];
    equity_history?: any[];
}

// Helper to find closest price
export const findPrice = (data: MarketData[], targetDate: number) => {
    let closest = null;
    // Iterate backwards
    for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].date <= targetDate + 86400) { // Allow same day (within 24h?)
            if (data[i].date <= targetDate) {
                closest = data[i].close;
                break;
            }
        }
    }
    return closest;
};

// Calculate Performance Stats for a specific price series/benchmark
export const calculateBenchmarkStats = (prices: MarketData[], startDate: number, endDate: number, initialCost: number, deposits: Deposit[]): TWRResult | null => {
    if (!prices || prices.length === 0) return null;

    // Filter prices from startDate to endDate
    const relevantPrices = prices.filter(p => p.date >= startDate && p.date <= endDate);
    if (relevantPrices.length < 2) return null;

    // Map Deposits
    const depositMap = new Map<number, number>();
    deposits.forEach(d => {
        const dateObj = new Date(d.deposit_date * 1000);
        // Midnight UTC to match market data
        const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
        const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
        depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
    });

    const startPrice = relevantPrices[0].close;
    let shares = initialCost / startPrice;
    let prevEquity = initialCost;
    let prevNavRatio = 1.0;

    // Max Drawdown & New Highs (NAV Based)
    let peak = 1.0;
    let maxDd = 0;
    let newHighCount = 0;
    const dailyRets: number[] = [];

    relevantPrices.forEach((p, idx) => {
        const price = p.close;
        const date = p.date;
        const dailyDeposit = depositMap.get(date) || 0;

        // Buy shares at CLOSE
        if (dailyDeposit !== 0 && price > 0) {
            shares += dailyDeposit / price;
        }

        const currentEquity = shares * price;
        let dailyReturn = 0;

        if (idx > 0) {
            const startVal = prevEquity;
            // Formula matching Account Logic: (End - Dep - Start) / (Start + Dep)
            if (startVal + dailyDeposit !== 0) {
                dailyReturn = (currentEquity - dailyDeposit - startVal) / (startVal + dailyDeposit);
            }
        }

        dailyRets.push(dailyReturn);

        // Update NAV
        if (idx === 0) {
            prevNavRatio = 1.0;
        } else {
            prevNavRatio = prevNavRatio * (1 + dailyReturn);
        }

        // Stats
        if (prevNavRatio > peak) {
            peak = prevNavRatio;
            if (idx > 0) newHighCount++;
        }
        const dd = (prevNavRatio - peak) / peak;
        if (dd < maxDd) maxDd = dd;

        prevEquity = currentEquity;
    });

    const avgDaily = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
    const annRet = avgDaily * 252;
    const variance = dailyRets.reduce((a, b) => a + Math.pow(b - avgDaily, 2), 0) / (dailyRets.length - 1);
    const stdDev = Math.sqrt(variance);
    const annStdDev = stdDev * Math.sqrt(252);
    const sharpe = annStdDev !== 0 ? (annRet - 0.04) / annStdDev : 0;

    // New High Freq
    const daySpan = relevantPrices.length;
    const newHighFreq = daySpan > 0 ? newHighCount / daySpan : 0;

    return {
        startEquity: initialCost,
        currentEquity: prevEquity,
        returnPercentage: prevNavRatio - 1,
        maxDrawdown: maxDd,
        annualizedReturn: annRet,
        annualizedStdDev: annStdDev,
        sharpeRatio: sharpe,
        newHighCount,
        newHighFreq,
        dailyReturns: dailyRets
    };
};

export const calculateUserTwr = (
    uEq: EquityRecord[],
    uDep: Deposit[],
    initialCost: number,
    benchmarkStartDate: number,
    qqqData: MarketData[],
    qldData: MarketData[]
) => {
    let chartData: { date: number; net_equity: number; rate: number; qqq_rate?: number; qld_rate?: number }[] = [];

    if (uEq.length === 0) {
        return {
            summary: {
                current_net_equity: initialCost || 0,
                stats: null,
                equity_history: []
            },
            dailyReturns: []
        };
    }

    // Map Deposits
    const depositMap = new Map<number, number>();
    uDep.forEach(d => {
        const dateObj = new Date(d.deposit_date * 1000);
        const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
        const amount = d.transaction_type === 'withdrawal' ? -d.amount : d.amount;
        depositMap.set(midnight, (depositMap.get(midnight) || 0) + amount);
    });

    let prevNavRatio = 1.0;
    let prevEquity = initialCost || 0;
    let peakNavRatio = 1.0;
    let minDrawdown = 0;
    let newHighCount = 0;
    let dailyReturns: number[] = [];

    // Determine Start Price from Market Data
    let startQQQ = 0;
    let startQLD = 0;

    if (uEq.length > 0) {
        const firstDate = uEq[0].date;
        const targetStart = benchmarkStartDate ? benchmarkStartDate : firstDate;

        startQQQ = findPrice(qqqData, targetStart) || 0;
        startQLD = findPrice(qldData, targetStart) || 0;
    }

    // Benchmark Running State for TWR
    let qqqShares = startQQQ > 0 ? (initialCost || 0) / startQQQ : 0;
    let qldShares = startQLD > 0 ? (initialCost || 0) / startQLD : 0;

    let prevQQQEquity = initialCost || 0;
    let prevQLDEquity = initialCost || 0;

    let prevQQQNav = 1.0;
    let prevQLDNav = 1.0;

    uEq.forEach((row, i) => {
        const date = row.date;
        const equity = row.net_equity;
        const dateObj = new Date(date * 1000);
        const midnight = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())).getTime() / 1000;
        const dailyDeposit = depositMap.get(midnight) || 0;

        let dailyReturn = 0;
        // Calculate daily return
        if (prevEquity + dailyDeposit !== 0) {
            dailyReturn = (equity - dailyDeposit - prevEquity) / (prevEquity + dailyDeposit);
        }

        dailyReturns.push(dailyReturn);
        const navRatio = prevNavRatio * (1 + dailyReturn);

        // Benchmark Rates (TWR Calculation)
        const qqqPrice = findPrice(qqqData, midnight) || 0;
        const qldPrice = findPrice(qldData, midnight) || 0;

        let qqqRate = undefined;
        let qldRate = undefined;

        // QQQ TWR Logic
        if (startQQQ > 0 && qqqPrice > 0) {
            if (dailyDeposit !== 0) {
                qqqShares += dailyDeposit / qqqPrice;
            }
            const currQQQEquity = qqqShares * qqqPrice;
            let dailyQQQRet = 0;
            if (prevQQQEquity + dailyDeposit !== 0) {
                dailyQQQRet = (currQQQEquity - dailyDeposit - prevQQQEquity) / (prevQQQEquity + dailyDeposit);
            }
            prevQQQNav = (i === 0 ? 1.0 : prevQQQNav) * (1 + dailyQQQRet);
            qqqRate = (prevQQQNav - 1) * 100;
            prevQQQEquity = currQQQEquity;
        }

        // QLD TWR Logic
        if (startQLD > 0 && qldPrice > 0) {
            if (dailyDeposit !== 0) {
                qldShares += dailyDeposit / qldPrice;
            }
            const currQLDEquity = qldShares * qldPrice;
            let dailyQLDRet = 0;
            if (prevQLDEquity + dailyDeposit !== 0) {
                dailyQLDRet = (currQLDEquity - dailyDeposit - prevQLDEquity) / (prevQLDEquity + dailyDeposit);
            }
            prevQLDNav = (i === 0 ? 1.0 : prevQLDNav) * (1 + dailyQLDRet);
            qldRate = (prevQLDNav - 1) * 100;
            prevQLDEquity = currQLDEquity;
        }

        chartData.push({
            date: date,
            net_equity: equity,
            rate: (navRatio - 1) * 100,
            qqq_rate: qqqRate,
            qld_rate: qldRate
        });

        if (navRatio > peakNavRatio) {
            peakNavRatio = navRatio;
            newHighCount++;
        }

        const dd = (navRatio - peakNavRatio) / peakNavRatio;
        if (dd < minDrawdown) minDrawdown = dd;

        prevNavRatio = navRatio;
        prevEquity = equity;
    });

    const daySpan = uEq.length;
    const avgDailyReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a: number, b: number) => a + b, 0) / dailyReturns.length : 0;
    const annualizedReturn = avgDailyReturn * 252;

    let annualizedStdDev = 0;
    if (dailyReturns.length > 0) {
        const mean = avgDailyReturn;
        const variance = dailyReturns.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / (dailyReturns.length - 1);
        const stdDev = Math.sqrt(variance);
        annualizedStdDev = stdDev * Math.sqrt(252);
    }
    const sharpe = annualizedStdDev !== 0 ? (annualizedReturn - 0.04) / annualizedStdDev : 0;

    return {
        summary: {
            initial_cost: initialCost || 0,
            current_net_equity: uEq.length > 0 ? uEq[uEq.length - 1].net_equity : (initialCost || 0),
            stats: {
                startDate: uEq.length > 0 ? uEq[0].date : 0,
                returnPercentage: prevNavRatio - 1,
                maxDrawdown: minDrawdown,
                annualizedReturn,
                annualizedStdDev,
                sharpeRatio: sharpe,
                newHighCount: newHighCount,
                newHighFreq: daySpan > 0 ? newHighCount / daySpan : 0
            },
            equity_history: chartData
        },
        dailyReturns
    };
};
