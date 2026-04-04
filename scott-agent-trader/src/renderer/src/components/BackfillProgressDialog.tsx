import React, { useEffect, useRef, useState } from 'react'

type SymbolStatus = 'pending' | 'loading' | 'done' | 'error'

interface SymbolBackfillState {
  symbol: string
  status: SymbolStatus
  found?: number
  updated?: number
  error?: string
}

interface BackfillProgressDialogProps {
  d1Target: 'staging' | 'production'
  onClose: () => void
}

export default function BackfillProgressDialog({
  d1Target,
  onClose
}: BackfillProgressDialogProps): React.JSX.Element {
  const [items, setItems] = useState<SymbolBackfillState[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const [totalUpdated, setTotalUpdated] = useState(0)
  const [totalFound, setTotalFound] = useState(0)
  const [finished, setFinished] = useState(false)
  const [discovering, setDiscovering] = useState(true)
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (runningRef.current) return
    runningRef.current = true

    const backfillOne = async (sym: string, i: number): Promise<void> => {
      if (cancelledRef.current) return

      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'loading' } : it)))

      try {
        const result = await window.ibApi.backfillUnderlyingPrice(sym, d1Target)
        if (cancelledRef.current) return
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: result.success ? 'done' : 'error',
                  found: result.found,
                  updated: result.updated,
                  error: result.error
                }
              : it
          )
        )
        if (result.success) {
          setDoneCount((c) => c + 1)
          setTotalFound((f) => f + (result.found ?? 0))
          setTotalUpdated((u) => u + (result.updated ?? 0))
        }
      } catch (e: unknown) {
        if (cancelledRef.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setItems((prev) =>
          prev.map((it, idx) => (idx === i ? { ...it, status: 'error', error: msg } : it))
        )
      }
    }

    const run = async (): Promise<void> => {
      // First discover which symbols need backfill
      const symbols = await window.ibApi.getMissingPriceSymbols(d1Target)
      setDiscovering(false)

      if (symbols.length === 0) {
        setFinished(true)
        return
      }

      setItems(symbols.map((s) => ({ symbol: s, status: 'pending' as SymbolStatus })))

      // Process symbols sequentially (IB pacing)
      for (let i = 0; i < symbols.length; i++) {
        if (cancelledRef.current) break
        await backfillOne(symbols[i], i)
      }
      setFinished(true)
    }

    run()
  }, [])

  const handleCancel = (): void => {
    cancelledRef.current = true
    setFinished(true)
  }

  const symbolCount = items.length

  return (
    <div className="upload-dialog-overlay">
      <div className="upload-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="upload-dialog-header">
          <h3>回填當時股價（1分鐘精度）</h3>
          {finished && (
            <button className="upload-dialog-close" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {discovering ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
            正在查詢缺少當時股價的期權記錄…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
            所有期權記錄都已有當時股價，無需回填 ✓
          </div>
        ) : (
          <ul className="upload-dialog-list">
            {items.map((it) => (
              <li key={it.symbol} className={`upload-dialog-row ${it.status}`}>
                <span className="upload-dialog-symbol">{it.symbol}</span>
                <span className="upload-dialog-status">
                  {it.status === 'pending' && <span className="status-pending">—</span>}
                  {it.status === 'loading' && <span className="status-spinner">⏳</span>}
                  {it.status === 'done' && (
                    <span className="status-done">
                      ✓ {it.found === 0 ? '無缺漏' : `找到 ${it.found}，已更新 ${it.updated}`}
                    </span>
                  )}
                  {it.status === 'error' && (
                    <span className="status-error" title={it.error}>
                      ✗ {it.error ?? '失敗'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="upload-dialog-footer">
          <span>
            {discovering
              ? '查詢中…'
              : finished
                ? `完成 ${doneCount}/${symbolCount} 標的，找到 ${totalFound} 筆，回填 ${totalUpdated} 筆`
                : `回填中 ${doneCount}/${symbolCount} 標的，已回填 ${totalUpdated} 筆…`}
          </span>
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
