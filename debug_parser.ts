
import fs from 'fs';
import path from 'path';

// Mocking the parseIBStockTrades function from src/app/api/stocks/import-ib/route.ts
// tailored to run in a standalone node script (removing DB deps)

function parseIBStockTrades(html: string) {
    const trades: any[] = [];

    // Find Transactions section
    const txnSectionMatch = html.match(/id="tblTransactions_[^"]*Body"[^>]*>([\s\S]*?)<\/table>/);

    if (txnSectionMatch) {
        let txnHtml = txnSectionMatch[1];

        // Find "Stocks" section within Transactions
        // Using the regex from the source file
        const stockSectionMatch = txnHtml.match(/header-asset[^>]*>股票<\/td>[\s\S]*?<\/tbody>([\s\S]*?)(?=<thead>|<\/table>|header-asset[^>]*>股票和指數期權)/);

        if (stockSectionMatch) {
            const stockHtml = stockSectionMatch[1];
            // Regex to parse rows
            const regex = /<tbody>\s*<tr>\s*<td>(.*?)<\/td>\s*<td>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>/g;

            let match;
            while ((match = regex.exec(stockHtml)) !== null) {
                const symbol = match[1].trim();
                const dateTime = match[2].trim();
                const quantity = parseFloat(match[3].replace(/,/g, ''));
                const tradePrice = parseFloat(match[4].replace(/,/g, ''));
                const closePrice = parseFloat(match[5].replace(/,/g, ''));
                const realizedPnL = parseFloat(match[9].replace(/,/g, ''));
                const tradeCode = match[11].trim();

                const isOpen = tradeCode.includes('O');
                const isClose = tradeCode.includes('C');

                trades.push({
                    symbol,
                    dateTime,
                    quantity,
                    tradePrice,
                    tradeCode,
                    isOpen,
                    isClose
                });
            }
        } else {
            console.log("No Stock section found in Transactions");
        }
    } else {
        console.log("No Transactions section found");
    }

    return trades;
}

const filePath = 'C:\\Users\\scott\\my project\\scott-agent\\報表_ROBEN\\U16818182_20260121.htm';
const html = fs.readFileSync(filePath, 'utf-8');
const results = parseIBStockTrades(html);
console.log(JSON.stringify(results, null, 2));
