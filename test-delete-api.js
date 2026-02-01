// Test DELETE API for market data
// ===================================
// This script tests if the DELETE endpoint is working correctly

const symbol = 'QQQ';
const testDate = 1738195200; // 26-01-30 (the date shown in screenshot)

async function testDelete() {
    const url = `http://localhost:3000/api/market-data?symbol=${symbol}&date=${testDate}`;

    console.log('Testing DELETE endpoint...');
    console.log('URL:', url);
    console.log('Symbol:', symbol);
    console.log('Date:', testDate, '(', new Date(testDate * 1000).toISOString(), ')');
    console.log('---');

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        const data = await response.json();

        console.log('Response status:', response.status);
        console.log('Response data:', JSON.stringify(data, null, 2));

        if (data.success) {
            console.log('✅ DELETE successful!');

            // Now try to fetch the data to see if it's really gone
            console.log('\nVerifying deletion by fetching data...');
            const verifyUrl = `http://localhost:3000/api/market-data?symbol=${symbol}`;
            const verifyResponse = await fetch(verifyUrl);
            const verifyData = await verifyResponse.json();

            console.log('Market data response:', verifyData);

            // Check if the deleted date is still in the results
            const stillExists = verifyData.some?.(item => item.date === testDate);
            if (stillExists) {
                console.log('❌ ERROR: Record still exists after deletion!');
            } else {
                console.log('✅ Record successfully deleted from database');
            }
        } else {
            console.log('❌ DELETE failed:', data.error);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testDelete();
