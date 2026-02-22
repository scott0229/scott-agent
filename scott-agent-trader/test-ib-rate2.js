/**
 * test-ib-rate2.js
 * 試驗更多可能 IB 利率 ticker
 */

const { IBApi, EventName, SecType } = require('@stoqey/ib')

const PORT = 7497
const HOST = '127.0.0.1'
const CLIENT_ID = 998

const ib = new IBApi({ port: PORT, host: HOST, clientId: CLIENT_ID })

// 各種可能組合：symbol / secType / exchange
const candidates = [
  { symbol: 'USFD',  secType: 'IND', exchange: 'NYSE',   desc: 'USFD/NYSE' },
  { symbol: 'USFD',  secType: 'IND', exchange: 'NASDAQ', desc: 'USFD/NASDAQ' },
  { symbol: 'IBKR',  secType: 'IND', exchange: 'NASDAQ', desc: 'IBKR IND' },
  { symbol: 'GS',    secType: 'STK', exchange: 'SMART',  desc: 'GS STK (test)' },
  { symbol: 'SHY',   secType: 'STK', exchange: 'SMART',  desc: 'SHY ETF (T-Bill proxy)' },
  { symbol: 'IBKR',  secType: 'STK', exchange: 'SMART',  desc: 'IBKR STK (test)' },
]

let reqIdBase = 20000
const results = {}

ib.on(EventName.connected, () => {
  console.log('✅ Connected to TWS port', PORT)
  ib.reqMarketDataType(4)

  candidates.forEach((c, i) => {
    const reqId = reqIdBase + i
    const contract = {
      symbol: c.symbol,
      secType: c.secType,
      exchange: c.exchange,
      currency: 'USD',
    }
    results[reqId] = { ...c, ticks: [] }
    console.log(`📡 Requesting [${c.desc}] reqId=${reqId}`)
    ib.reqMktData(reqId, contract, '', true, false)
  })

  setTimeout(() => {
    console.log('\n=== 結果 ===')
    Object.values(results).forEach(r => {
      const status = r.ticks.length ? r.ticks.join(', ') : '無資料'
      console.log(`${r.desc}: ${status}`)
    })
    ib.disconnect()
    process.exit(0)
  }, 6000)
})

ib.on(EventName.tickPrice, (reqId, tickType, value) => {
  if (!results[reqId]) return
  const names = { 1:'bid',2:'ask',4:'last',9:'close',68:'d_bid',69:'d_ask',70:'d_last',75:'d_close' }
  const n = names[tickType] || `t${tickType}`
  if (value > 0) {
    results[reqId].ticks.push(`${n}=${value}`)
    console.log(`  [${results[reqId].desc}] ${n}=${value}`)
  }
})

ib.on(EventName.tickGeneric, (reqId, tickType, value) => {
  if (!results[reqId]) return
  results[reqId].ticks.push(`gen${tickType}=${value}`)
  console.log(`  [${results[reqId].desc}] generic tickType=${tickType} value=${value}`)
})

ib.on(EventName.tickString, (reqId, tickType, value) => {
  if (!results[reqId]) return
  results[reqId].ticks.push(`str${tickType}=${value}`)
  console.log(`  [${results[reqId].desc}] tickString tickType=${tickType} value=${value}`)
})

ib.on(EventName.error, (err, code, reqId) => {
  if (results[reqId]) {
    console.warn(`  ⚠️ [${results[reqId].desc}] Error ${code}: ${err?.message || err}`)
    results[reqId].ticks.push(`ERR_${code}`)
  } else if (![2104,2106,2158,2119].includes(code)) {
    console.error(`❌ IB Error [${code}]: ${err?.message || err}`)
  }
})

ib.on(EventName.disconnected, () => console.log('🔌 Disconnected'))

console.log(`Connecting to ${HOST}:${PORT}...`)
ib.connect()
