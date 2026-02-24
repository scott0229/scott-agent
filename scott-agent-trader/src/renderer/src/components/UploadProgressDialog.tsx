import React, { useEffect, useRef, useState } from 'react'

export type SymbolStatus = 'pending' | 'loading' | 'done' | 'error'

export interface SymbolUploadState {
    symbol: string
    status: SymbolStatus
    count?: number
    error?: string
}

interface UploadProgressDialogProps {
    symbols: string[]
    onClose: () => void
}

export default function UploadProgressDialog({
    symbols,
    onClose
}: UploadProgressDialogProps): React.JSX.Element {
    const [items, setItems] = useState<SymbolUploadState[]>(
        symbols.map((s) => ({ symbol: s, status: 'pending' }))
    )
    const [doneCount, setDoneCount] = useState(0)
    const [totalRows, setTotalRows] = useState(0)
    const [finished, setFinished] = useState(false)
    const cancelledRef = useRef(false)
    const runningRef = useRef(false)

    useEffect(() => {
        if (runningRef.current) return
        runningRef.current = true

        const uploadOne = async (sym: string, i: number): Promise<void> => {
            if (cancelledRef.current) return

            setItems((prev) =>
                prev.map((it, idx) => (idx === i ? { ...it, status: 'loading' } : it))
            )

            try {
                const result = await window.ibApi.uploadSymbol(sym)
                if (cancelledRef.current) return
                setItems((prev) =>
                    prev.map((it, idx) =>
                        idx === i
                            ? {
                                ...it,
                                status: result.success ? 'done' : 'error',
                                count: result.count,
                                error: result.error
                            }
                            : it
                    )
                )
                if (result.success) {
                    setDoneCount((c) => c + 1)
                    setTotalRows((r) => r + (result.count ?? 0))
                }
            } catch (e: unknown) {
                if (cancelledRef.current) return
                const msg = e instanceof Error ? e.message : String(e)
                setItems((prev) =>
                    prev.map((it, idx) => (idx === i ? { ...it, status: 'error', error: msg } : it))
                )
            }
        }

        Promise.all(symbols.map((sym, i) => uploadOne(sym, i))).then(() => {
            setFinished(true)
        })
    }, [])


    const handleCancel = (): void => {
        cancelledRef.current = true
        setFinished(true)
    }

    return (
        <div className="upload-dialog-overlay">
            <div className="upload-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="upload-dialog-header">
                    <h3>上傳最近一年股價</h3>
                    {finished && (
                        <button className="upload-dialog-close" onClick={onClose}>
                            ✕
                        </button>
                    )}
                </div>

                <ul className="upload-dialog-list">
                    {items.map((it) => (
                        <li key={it.symbol} className={`upload-dialog-row ${it.status}`}>
                            <span className="upload-dialog-symbol">{it.symbol}</span>
                            <span className="upload-dialog-status">
                                {it.status === 'pending' && <span className="status-pending">—</span>}
                                {it.status === 'loading' && <span className="status-spinner">⏳</span>}
                                {it.status === 'done' && (
                                    <span className="status-done">✓ {it.count} 筆</span>
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

                <div className="upload-dialog-footer">
                    <span>
                        {finished
                            ? `完成 ${doneCount}/${symbols.length} 標的，共 ${totalRows.toLocaleString()} 筆`
                            : `上傳中 ${doneCount}/${symbols.length} 標的…`}
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
