import React, { useEffect, useRef, useState } from 'react'

type SymbolStatus = 'pending' | 'loading' | 'done' | 'error'

interface RowState {
  symbol: string
  phase: 'upload' | 'backfill'
  status: SymbolStatus
  detail?: string
  error?: string
}

interface PriceSyncDialogProps {
  symbols: string[] // symbols to upload
  d1Target: 'staging' | 'production'
  onClose: () => void
}

export default function PriceSyncDialog({
  symbols,
  d1Target,
  onClose
}: PriceSyncDialogProps): React.JSX.Element {
  const [rows, setRows] = useState<RowState[]>(
    symbols.map((s) => ({ symbol: s, phase: 'upload' as const, status: 'pending' as SymbolStatus }))
  )
  const [phase, setPhase] = useState<'upload' | 'backfill-discover' | 'backfill' | 'done'>('upload')
  const [uploadDone, setUploadDone] = useState(0)
  const [uploadTotal] = useState(symbols.length)
  const [backfillDone, setBackfillDone] = useState(0)
  const [backfillTotal, setBackfillTotal] = useState(0)
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (runningRef.current) return
    runningRef.current = true

    const run = async (): Promise<void> => {
      // === Phase 1: Upload ===
      const uploadOne = async (sym: string, i: number): Promise<void> => {
        if (cancelledRef.current) return
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'loading' } : r)))
        try {
          const result = await window.ibApi.uploadSymbol(sym, d1Target)
          if (cancelledRef.current) return
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i
                ? {
                    ...r,
                    status: result.success ? 'done' : 'error',
                    detail: result.success ? `${result.count} 筆` : undefined,
                    error: result.error
                  }
                : r
            )
          )
          if (result.success) setUploadDone((c) => c + 1)
        } catch (e: unknown) {
          if (cancelledRef.current) return
          const msg = e instanceof Error ? e.message : String(e)
          setRows((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'error', error: msg } : r))
          )
        }
      }

      await Promise.all(symbols.map((sym, i) => uploadOne(sym, i)))
      if (cancelledRef.current) {
        setPhase('done')
        return
      }

      // === Phase 2: Backfill discover ===
      setPhase('backfill-discover')
      let backfillSymbols: string[] = []
      try {
        backfillSymbols = await window.ibApi.getMissingPriceSymbols(d1Target)
      } catch {
        // If discovery fails, just finish
        setPhase('done')
        return
      }

      if (backfillSymbols.length === 0 || cancelledRef.current) {
        setPhase('done')
        return
      }

      // === Phase 3: Backfill ===
      setPhase('backfill')
      setBackfillTotal(backfillSymbols.length)
      const uploadRowCount = symbols.length
      const backfillRows: RowState[] = backfillSymbols.map((s) => ({
        symbol: s,
        phase: 'backfill' as const,
        status: 'pending' as SymbolStatus
      }))
      setRows((prev) => [...prev, ...backfillRows])

      for (let i = 0; i < backfillSymbols.length; i++) {
        if (cancelledRef.current) break
        const globalIdx = uploadRowCount + i
        setRows((prev) =>
          prev.map((r, idx) => (idx === globalIdx ? { ...r, status: 'loading' } : r))
        )
        try {
          const result = await window.ibApi.backfillUnderlyingPrice(backfillSymbols[i], d1Target)
          if (cancelledRef.current) break
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === globalIdx
                ? {
                    ...r,
                    status: result.success ? 'done' : 'error',
                    detail: result.success
                      ? result.found === 0
                        ? '無缺漏'
                        : `找到 ${result.found}，已更新 ${result.updated}`
                      : undefined,
                    error: result.error
                  }
                : r
            )
          )
          if (result.success) setBackfillDone((c) => c + 1)
        } catch (e: unknown) {
          if (cancelledRef.current) break
          const msg = e instanceof Error ? e.message : String(e)
          setRows((prev) =>
            prev.map((r, idx) => (idx === globalIdx ? { ...r, status: 'error', error: msg } : r))
          )
        }
      }

      setPhase('done')
    }

    run()
  }, [])

  const handleCancel = (): void => {
    cancelledRef.current = true
    setPhase('done')
  }

  const finished = phase === 'done'

  // Footer status text
  let footerText = ''
  if (phase === 'upload') {
    footerText = `☁ 上傳中 ${uploadDone}/${uploadTotal} 標的…`
  } else if (phase === 'backfill-discover') {
    footerText = `☁ 上傳完成 ${uploadDone}/${uploadTotal} — 🔍 查詢需回填標的…`
  } else if (phase === 'backfill') {
    footerText = `☁ 上傳 ${uploadDone}/${uploadTotal} — 📊 回填中 ${backfillDone}/${backfillTotal}…`
  } else {
    footerText =
      backfillTotal > 0
        ? `☁ 上傳 ${uploadDone}/${uploadTotal}　📊 回填 ${backfillDone}/${backfillTotal}　✓ 完成`
        : `☁ 上傳 ${uploadDone}/${uploadTotal}　📊 無需回填　✓ 完成`
  }

  return (
    <div className="upload-dialog-overlay">
      <div className="upload-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="upload-dialog-header">
          <h3>📈 股價同步</h3>
          {finished && (
            <button className="upload-dialog-close" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {phase === 'backfill-discover' && rows.every((r) => r.phase === 'upload') && (
          <div style={{ padding: '12px 16px', textAlign: 'center', color: '#888', fontSize: 13 }}>
            🔍 正在查詢需要回填的期權記錄…
          </div>
        )}

        <ul className="upload-dialog-list">
          {rows.map((it, i) => (
            <li key={`${it.phase}-${it.symbol}-${i}`} className={`upload-dialog-row ${it.status}`}>
              <span className="upload-dialog-symbol">
                {it.phase === 'backfill' ? '📊 ' : <span style={{ color: '#2563eb' }}>☁ </span>}
                {it.symbol}
              </span>
              <span className="upload-dialog-status">
                {it.status === 'pending' && <span className="status-pending">—</span>}
                {it.status === 'loading' && <span className="status-spinner">⏳</span>}
                {it.status === 'done' && <span className="status-done">✓ {it.detail}</span>}
                {it.status === 'error' && (
                  <span className="status-error" title={it.error}>
                    ✗ {it.error ?? '失敗'}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <div className="upload-dialog-footer">
          <span>{footerText}</span>
          {finished ? (
            <button className="upload-dialog-done-btn" onClick={onClose}>
              關閉
            </button>
          ) : (
            <button className="upload-dialog-cancel-btn" onClick={handleCancel}>
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
