import React, { useCallback, useEffect, useRef, useState } from 'react'

// Highlight contract mentions like "QQQ 737C" / "TQQQ 60.5P" inside the
// note, optionally suffixed with the underlying spot price "(@706.1)".
const TICKER_RE = /\b([A-Z]{2,5})\s+(\d+(?:\.\d+)?)([CP])\b/g

function renderNote(text: string, quotes: Record<string, number>): React.ReactNode {
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  TICKER_RE.lastIndex = 0
  while ((m = TICKER_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const symbol = m[1]
    const price = quotes[symbol]
    const label =
      price != null && price > 0 ? `${m[0]} (@${price.toFixed(1)})` : m[0]
    out.push(
      <span key={`${m.index}-${m[0]}`} className="report-note-ticker">
        {label}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Convert a click point inside the rendered note div into a string offset
// in the raw note text. The display div may contain pill spans that wrap a
// substring of the text — we walk text nodes in document order until we
// hit the click target and sum their lengths.
function pointToTextOffset(container: Node, clientX: number, clientY: number): number | null {
  type CaretFn = (x: number, y: number) => Range | null
  const fn = (document as Document & { caretRangeFromPoint?: CaretFn }).caretRangeFromPoint
  if (typeof fn !== 'function') return null
  const range = fn.call(document, clientX, clientY)
  if (!range || !range.startContainer) return null
  let offset = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) {
      return offset + range.startOffset
    }
    offset += node.textContent?.length ?? 0
  }
  return null
}

interface ReportNoteBoxProps {
  value: string | undefined
  quotes: Record<string, number>
  // Editing is allowed when this is provided; the value is saved on blur.
  onSave?: (value: string) => void
  // External request to open the editor — driven by an "add note" button in
  // the card header. When the note is empty AND this is false AND we're not
  // already editing, the box renders nothing at all (no placeholder strip).
  // Parent resets this to false via onClose once editing finishes.
  open?: boolean
  onClose?: () => void
  // Fired whenever the editor's height changes (open, type, IME commit). Lets
  // a masonry parent re-measure the card so it grows to fit live.
  onResize?: () => void
  // Fired when the editor opens/closes. Lets a draggable parent card disable
  // its drag while editing, so dragging to select text doesn't move the card.
  onEditingChange?: (editing: boolean) => void
}

/**
 * Editable amber sticky-note. Click anywhere to enter edit mode; the caret
 * lands at the click point. Blurring saves (or defers until IME composition
 * finishes — that's the only way to dismiss Microsoft 注音's candidate window
 * without orphaning it). Used by the account card AND the batch trading
 * group card so they share one implementation of the IME / pill / sizing
 * machinery.
 */
export default function ReportNoteBox({
  value,
  quotes,
  onSave,
  open = false,
  onClose,
  onResize,
  onEditingChange
}: ReportNoteBoxProps): React.JSX.Element | null {
  const [editing, setEditing] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  // Seed the textarea height from the display div's offsetHeight so the box
  // doesn't visibly shrink when switching modes. Subsequent input keeps
  // growing via onInput / onCompositionEnd.
  const [height, setHeight] = useState<number | null>(null)

  // Stable refs — keeping the ref to the textarea between renders is what
  // protects IME composition from being dropped (an inline ref callback
  // re-fires every parent render and ends up resetting things).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  // If blur fires mid-composition, we can't unmount the textarea — the IME
  // would lose its target. Stash the value here and act on it from
  // compositionend instead.
  const pendingBlurRef = useRef<string | null>(null)

  // Honour an external open request (rising edge only). Drop into edit mode
  // with the caret at the end of any existing text.
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      composingRef.current = false
      pendingBlurRef.current = null
      setCaret((value || '').length)
      setHeight(null)
      setEditing(true)
    }
    prevOpenRef.current = open
  }, [open, value])

  // Notify the parent only on actual edit-mode transitions (guarded by a ref
  // so an inline onEditingChange that changes identity each render can't spam).
  const prevEditingRef = useRef(editing)
  useEffect(() => {
    if (prevEditingRef.current !== editing) {
      prevEditingRef.current = editing
      onEditingChange?.(editing)
    }
  }, [editing, onEditingChange])

  // One-shot init the moment editing starts (sized, caret-positioned,
  // focused). Subsequent re-renders never touch the textarea DOM.
  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    if (height != null) {
      el.style.height = height + 'px'
    } else {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
    if (caret != null) {
      el.setSelectionRange(caret, caret)
    }
    el.focus()
    onResize?.()
  }, [editing, height, caret, onResize])

  const finishEdit = useCallback(
    (nextValue: string) => {
      if (onSave && nextValue !== (value || '')) {
        onSave(nextValue)
      }
      setEditing(false)
      setCaret(null)
      setHeight(null)
      onClose?.()
    },
    [onSave, value, onClose]
  )

  if (editing) {
    return (
      <textarea
        className="report-note report-note-editor"
        defaultValue={value || ''}
        ref={textareaRef}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
          onResize?.()
          const pending = pendingBlurRef.current
          if (pending != null) {
            pendingBlurRef.current = null
            finishEdit(pending)
          }
        }}
        onInput={(e) => {
          if (composingRef.current) return
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
          onResize?.()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const v = e.currentTarget.value
          if (composingRef.current) {
            pendingBlurRef.current = v
            return
          }
          finishEdit(v)
        }}
      />
    )
  }

  // Empty note: render nothing. The entry point for creating a note is the
  // "add note" button in the card header (which flips `open` to true).
  if (!value) return null

  return (
    <div
      className="report-note"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (!onSave) return
        // If the click ended a text selection (drag-select to copy), don't
        // hijack into edit mode — let the selection stand.
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed && sel.toString().length > 0) return
        const div = e.currentTarget
        const c = pointToTextOffset(div, e.clientX, e.clientY)
        composingRef.current = false
        pendingBlurRef.current = null
        setCaret(c ?? value.length)
        setHeight(div.offsetHeight)
        setEditing(true)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={onSave ? '點擊編輯' : undefined}
      style={{ cursor: onSave ? 'text' : 'default' }}
    >
      {renderNote(value, quotes)}
    </div>
  )
}
