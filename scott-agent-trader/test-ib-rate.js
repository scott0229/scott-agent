/**
 * test-ib-rate.js
 * 
 * 從 IB Gateway 抓取 benchmark 利率（Fed Funds Rate）
 * 執行：node test-ib-rate.js
 * 
 * IB 利率相關 tickers：
 *   USFD  - US Federal Funds Rate (IND on CBOE)
 *   USIBKR- IB Benchmark Rate (if available)
 */

const { IBApi, EventName, SecType } = require('@stoqey/ib')

const PORT = 7497   // TWS port
const HOST = '127.0.0.1'
const CLIENT_ID = 999

const ib = new IBApi({ port: PORT, host: HOST, clientId: CLIENT_ID })

const candidates = [
  { symbol: 'USFD',  exchange: 'CBOE',   desc: 'US Fed Funds Rate' },
  { symbol: 'SOFR',  exchange: 'CBOE',   desc: 'SOFR Rate' },
  { symbol: 'LIBOR', exchange: 'CBOE',   desc: 'LIBOR (deprecated)' },
]

let reqIdBase = 10000
const results = {}
let received = 0

ib.on(EventName.connected, () => {
  console.log('✅ Connected to IB Gateway')
  ib.reqMarketDataType(4)  // delayed/frozen

  candidates.forEach((c, i) => {
    const reqId = reqIdBase + i
    const contract = {
      symbol: c.symbol,
      secType: SecType.IND,
      exchange: c.exchange,
      currency: 'USD',
    }
    results[reqId] = { ...c, ticks: [] }
    console.log(`📡 Requesting ${c.desc} (${c.symbol}) reqId=${reqId}`)
    ib.reqMktData(reqId, contract, '', true, false)
  })

  // 5 秒後印出結果
  setTimeout(() => {
    console.log('\n=== 結果 ===')
    Object.values(results).forEach(r => {
      console.log(`${r.desc} (${r.symbol}):`, r.ticks.length ? r.ticks : '無資料')
    })
    ib.disconnect()
    process.exit(0)
  }, 5000)
})

ib.on(EventName.tickPrice, (reqId, tickType, value, attrib) => {
  if (results[reqId]) {
    const tickNames = {
      1: 'bid', 2: 'ask', 4: 'last', 6: 'high', 7: 'low', 9: 'close',
      68: 'delayed_bid', 69: 'delayed_ask', 70: 'delayed_last', 75: 'delayed_close'
    }
    const name = tickNames[tickType] || `tick_${tickType}`
    results[reqId].ticks.push(`${name}=${value}`)
    console.log(`  [reqId=${reqId}] tickPrice: ${name}=${value}`)
  }
})

ib.on(EventName.tickGeneric, (reqId, tickType, value) => {
  if (results[reqId]) {
    results[reqId].ticks.push(`generic_${tickType}=${value}`)
    console.log(`  [reqId=${reqId}] tickGeneric: type=${tickType} value=${value}`)
  }
})

ib.on(EventName.error, (err, code, reqId) => {
  if (results[reqId]) {
    console.warn(`  ⚠️ Error for reqId=${reqId}: [${code}] ${err?.message || err}`)
    results[reqId].ticks.push(`ERROR_${code}`)
  } else if (code !== 2104 && code !== 2106 && code !== 2158) {
    console.error(`❌ IB Error [${code}]: ${err?.message || err}`)
  }
})

ib.on(EventName.disconnected, () => {
  console.log('🔌 Disconnected')
})

console.log(`Connecting to IB Gateway at ${HOST}:${PORT}...`)
ib.connect()
