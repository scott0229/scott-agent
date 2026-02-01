// Test if outputsize=full works with free tier
const fs = require('fs');
const ALPHA_VANTAGE_API_KEY = 'BJ9X47DS0OLOPYM0';

async function testFullOutput() {
    const symbol = 'QQQ';
    // Test with FULL output (same as backfill API)
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=full&apikey=${ALPHA_VANTAGE_API_KEY}`;

    let output = '';
    output += `Testing Alpha Vantage API with outputsize=full for ${symbol}...\n`;
    output += `URL: ${url}\n\n`;

    try {
        const response = await fetch(url);
        output += `HTTP Status: ${response.status} ${response.statusText}\n`;

        const data = await response.json();

        output += '\n=== Response Structure ===\n';
        output += 'Keys: ' + Object.keys(data).join(', ') + '\n\n';

        // Check for errors
        if (data['Error Message']) {
            output += `\n❌ API Error: ${data['Error Message']}\n`;
        } else if (data['Note']) {
            output += `\n⚠️  API Note (Rate Limit): ${data['Note']}\n`;
        } else if (data['Information']) {
            output += `\n⚠️  API Information: ${data['Information']}\n`;
        } else if (data['Meta Data']) {
            output += '\n✅ Meta Data found!\n';

            if (data['Time Series (Daily)']) {
                const dates = Object.keys(data['Time Series (Daily)']);
                output += `\n✅ Time Series Data found! (${dates.length} days total)\n`;
                output += `Date range: ${dates[dates.length - 1]} to ${dates[0]}\n`;
                output += '\nFirst 3 dates:\n';
                dates.slice(0, 3).forEach(date => {
                    const price = data['Time Series (Daily)'][date]['4. close'];
                    output += `  ${date}: $${price}\n`;
                });
            } else {
                output += '\n❌ No Time Series Data found\n';
            }
        } else {
            output += '\n❌ Unexpected response structure\n';
            output += 'First 500 chars of response:\n';
            output += JSON.stringify(data, null, 2).substring(0, 500) + '...\n';
        }

    } catch (error) {
        output += `Error: ${error.message}\n`;
    }

    console.log(output);
    fs.writeFileSync('alpha-vantage-full-test.txt', output);
    console.log('\n📝 Results saved to: alpha-vantage-full-test.txt');
}

testFullOutput();
