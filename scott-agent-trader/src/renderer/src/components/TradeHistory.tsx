import React from 'react'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { formatExpiry } from '../hooks/useOptionChain'
import CustomSelect from './CustomSelect'
import { compareSymbols } from '../lib/symbols'

interface FlexTrade {
  account: string
  symbol: string
  underlying: string
  assetCategory: string
  tradeDate: string
  dateTime: string
  buySell: string
  quantity: number
  price: number
  proceeds: number
  commission: number
  realizedPnl: number
  expiry: string
  strike: string
  putCall: string
  tradeID: string
}

interface TradeHistoryProps {
  accountAliases?: Record<string, string>
  d1Target: 'staging' | 'production'
}

const fmtDate = (d: string): string =>
  d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '-'

const fmtNum = (n: number, dp = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '-'

// Local cache of the last successful pull, stamped with the day it was fetched.
// IB rate-limits re-requests of the same Flex query, so: auto-fetch only on the
// FIRST open of a new day; the rest of the day (and every tab switch) just shows
// the cache. A failed retry never wipes it.
interface TradeCache {
  date: string
  rows: FlexTrade[]
}
const todayStr = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const cacheKey = (qid: string): string => `trader.flexTrades.${qid}`
function readCache(qid: string): TradeCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(qid))
    return raw ? (JSON.parse(raw) as TradeCache) : null
  } catch {
    return null
  }
}
function writeCache(qid: string, rows: FlexTrade[]): void {
  try {
    localStorage.setItem(cacheKey(qid), JSON.stringify({ date: todayStr(), rows }))
  } catch {
    /* ignore quota */
  }
}

// The 標的 (underlying) a trade belongs to — options carry an underlyingSymbol;
// stock trades fall back to their own symbol.
const underlyingOf = (t: FlexTrade): string => t.underlying || t.symbol

function instrument(t: FlexTrade): string {
  if (t.assetCategory === 'OPT' || t.putCall) {
    const strike = t.strike ? (Number.isInteger(+t.strike) ? t.strike : (+t.strike).toFixed(1)) : ''
    return `${t.underlying || t.symbol} ${t.expiry ? formatExpiry(t.expiry) : ''} ${strike}${t.putCall}`.trim()
  }
  return t.symbol
}

// 交易記錄 — pulls historical trades from IB's Flex Web Service. The token +
// queryId live in D1 (so they sync across devices); the token is AES-encrypted
// in the main process before storage, and only the ciphertext is kept here.
export default function TradeHistory({
  accountAliases = {},
  d1Target
}: TradeHistoryProps): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [tokenEnc, setTokenEnc] = useState<string | null>(null)
  const [queryId, setQueryId] = useState('1544675')
  const [tokenInput, setTokenInput] = useState('')
  const [trades, setTrades] = useState<FlexTrade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterAccount, setFilterAccount] = useState('')
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterRight, setFilterRight] = useState<'' | 'P' | 'C'>('')
  const [filterDate, setFilterDate] = useState('')

  // Account filter: only the accounts that actually appear in the loaded trades,
  // labelled with their alias and sorted — same shape as the 部位 tab's filter.
  const accountOptions = useMemo(() => {
    const ids = Array.from(new Set(trades.map((t) => t.account).filter(Boolean)))
    return ids
      .map((id) => ({ value: id, label: accountAliases[id] || id }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [trades, accountAliases])

  // 標的 filter: distinct underlyings present in the loaded trades, sorted.
  const symbolOptions = useMemo(() => {
    const syms = Array.from(new Set(trades.map(underlyingOf).filter(Boolean)))
    return syms.sort(compareSymbols).map((s) => ({ value: s, label: s }))
  }, [trades])

  // 日期 filter: distinct trade dates, newest first.
  const dateOptions = useMemo(() => {
    const ds = Array.from(new Set(trades.map((t) => t.tradeDate).filter(Boolean)))
    return ds.sort((a, b) => b.localeCompare(a)).map((d) => ({ value: d, label: fmtDate(d) }))
  }, [trades])

  const visibleTrades = useMemo(
    () =>
      trades.filter(
        (t) =>
          (!filterAccount || t.account === filterAccount) &&
          (!filterSymbol || underlyingOf(t) === filterSymbol) &&
          (!filterRight || t.putCall === filterRight) &&
          (!filterDate || t.tradeDate === filterDate)
      ),
    [trades, filterAccount, filterSymbol, filterRight, filterDate]
  )

  const load = useCallback(
    async (enc: string, qid: string) => {
      setLoading(true)
      setError(null)
      try {
        const rows = await window.ibApi.flexFetchTrades(enc, qid)
        rows.sort((a, b) => (b.dateTime || b.tradeDate).localeCompare(a.dateTime || a.tradeDate))
        setTrades(rows)
        writeCache(qid, rows)
        // Persist to D1 too, so it syncs across devices and matches what the
        // Worker cron writes (the app reads flex_trades from D1 on open).
        window.ibApi
          .putSettings('flex_trades', { date: todayStr(), rows: rows.slice(0, 1500) }, d1Target)
          .catch(() => {})
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        // Keep showing what we have (or the cache) — a failed retry (e.g. IB
        // rate limit) must not wipe the previously-loaded trades.
        setTrades((cur) => (cur.length ? cur : readCache(qid)?.rows || []))
      } finally {
        setLoading(false)
      }
    },
    [d1Target]
  )

  // Read flex_config from D1 on mount; auto-load trades if already configured.
  useEffect(() => {
    window.ibApi
      .getSettings(d1Target)
      .then((res) => {
        const fc = res?.settings?.flex_config as { queryId?: string; tokenEnc?: string } | undefined
        const ft = res?.settings?.flex_trades as { date?: string; rows?: FlexTrade[] } | undefined
        if (fc?.queryId) setQueryId(fc.queryId)
        if (fc?.tokenEnc) {
          setTokenEnc(fc.tokenEnc)
          const qid = fc.queryId || queryId
          // Prefer the Worker-cron-synced rows from D1 (no IB call needed). Only
          // fetch from IB if D1 has nothing yet (e.g. right after first setup,
          // before the cron has run).
          if (ft?.rows?.length) {
            setTrades(ft.rows)
            writeCache(qid, ft.rows)
          } else {
            const cached = readCache(qid)
            if (cached?.rows.length) setTrades(cached.rows)
            load(fc.tokenEnc, qid)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d1Target])

  const save = useCallback(async () => {
    if (!tokenInput.trim() || !queryId.trim()) return
    const enc = await window.ibApi.flexEncrypt(tokenInput.trim())
    await window.ibApi.putSettings('flex_config', { queryId: queryId.trim(), tokenEnc: enc }, d1Target)
    setTokenEnc(enc)
    setTokenInput('')
    load(enc, queryId.trim())
  }, [tokenInput, queryId, d1Target, load])

  const changeConfig = useCallback(async () => {
    await window.ibApi.putSettings('flex_config', {}, d1Target)
    // Clear the synced data + stamp so the cron re-syncs with the new config.
    await window.ibApi.putSettings('flex_trades', {}, d1Target).catch(() => {})
    await window.ibApi.putSettings('flex_synced_at', '', d1Target).catch(() => {})
    try {
      localStorage.removeItem(cacheKey(queryId))
    } catch {
      /* ignore */
    }
    setTokenEnc(null)
    setTrades([])
    setError(null)
  }, [d1Target, queryId])

  if (!loaded) {
    return <div style={{ padding: 24, color: '#888' }}>載入中…</div>
  }

  // ── Setup form (no token yet) ────────────────────────
  if (!tokenEnc) {
    return (
      <div className="trade-history-setup">
        <h3>連接 IB Flex 交易記錄</h3>
        <p className="th-hint">
          在 IBKR 後台建立 Activity Flex Query,並開啟 Flex Web Service 取得 Token。Token
          會加密後存到雲端(D1)同步,不會以明碼儲存。
        </p>
        <label className="th-field">
          <span>Query ID</span>
          <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="例如 1544675" />
        </label>
        <label className="th-field">
          <span>Token</span>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="貼上 Flex Web Service Token"
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <button className="th-btn-primary" onClick={save} disabled={!tokenInput.trim() || !queryId.trim()}>
          儲存並載入
        </button>
      </div>
    )
  }

  // ── Trades table ─────────────────────────────────────
  return (
    <>
      <div className="th-actions">
        {loading && <span className="th-meta">載入中…</span>}
        {error && <span className="th-error">{error}</span>}
        {accountOptions.length > 0 && (
          <CustomSelect
            className={`dropdown-no-scroll${filterAccount ? ' account-filter-active' : ''}`}
            value={filterAccount}
            onChange={setFilterAccount}
            options={[
              { value: '', label: `全部 ${accountOptions.length} 個帳戶` },
              ...accountOptions
            ]}
          />
        )}
        {dateOptions.length > 0 && (
          <CustomSelect
            className={`date-filter-select${filterDate ? ' account-filter-active' : ''}`}
            value={filterDate}
            onChange={setFilterDate}
            options={[{ value: '', label: '全部日期' }, ...dateOptions]}
          />
        )}
        {symbolOptions.length > 0 && (
          <CustomSelect
            className={`dropdown-no-scroll${filterSymbol ? ' account-filter-active' : ''}`}
            value={filterSymbol}
            onChange={setFilterSymbol}
            options={[{ value: '', label: '全部標的' }, ...symbolOptions]}
          />
        )}
        {trades.length > 0 && (
          <CustomSelect
            className={`dropdown-no-scroll${filterRight ? ' account-filter-active' : ''}`}
            value={filterRight}
            onChange={(v) => setFilterRight(v as '' | 'P' | 'C')}
            options={[
              { value: '', label: 'All Options' },
              { value: 'P', label: 'PUT' },
              { value: 'C', label: 'CALL' }
            ]}
          />
        )}
        <button className="select-toggle-btn" onClick={changeConfig}>
          變更設定
        </button>
      </div>
      <div className="trade-history">
        <div className="th-table-wrap">
        <table className="th-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>帳戶</th>
              <th>標的</th>
              <th>買賣</th>
              <th style={{ textAlign: 'right' }}>數量</th>
              <th style={{ textAlign: 'right' }}>成交價</th>
              <th style={{ textAlign: 'right' }}>金額</th>
              <th style={{ textAlign: 'right' }}>手續費</th>
              <th style={{ textAlign: 'right' }}>已實現損益</th>
            </tr>
          </thead>
          <tbody>
            {visibleTrades.map((t) => (
              <tr key={t.tradeID || `${t.account}-${t.dateTime}-${t.symbol}-${t.price}`}>
                <td>{fmtDate(t.tradeDate)}</td>
                <td>{accountAliases[t.account] || t.account}</td>
                <td>{instrument(t)}</td>
                <td style={{ color: t.buySell === 'SELL' ? '#c0392b' : '#1a6b3a' }}>{t.buySell}</td>
                <td style={{ textAlign: 'right' }}>{Math.abs(t.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.price)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.proceeds)}</td>
                <td style={{ textAlign: 'right' }}>{fmtNum(t.commission)}</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: t.realizedPnl > 0 ? '#1a6b3a' : t.realizedPnl < 0 ? '#c0392b' : '#888'
                  }}
                >
                  {t.realizedPnl ? fmtNum(t.realizedPnl) : '-'}
                </td>
              </tr>
            ))}
            {visibleTrades.length === 0 && !loading && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: '#888', padding: 20 }}>
                  {error ? '載入失敗' : '沒有交易記錄'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </>
  )
}
