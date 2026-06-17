import { app } from 'electron'
import { createWriteStream, existsSync, renameSync, statSync, type WriteStream } from 'fs'
import { join } from 'path'

// Unified debug log. Tees the main-process console (IB, settings, flex, …) to
// userData/debug.log so an intermittent bug that's hard to reproduce on demand
// is still captured during normal use. The Settings panel exposes a button to
// download this file (debug:saveLog), and the renderer can push its own lines
// via the debug:log IPC (appendLog).

let stream: WriteStream | null = null
let logPath = ''
// Roll the log aside once it passes this size so the file stays openable and
// the download stays small.
const MAX_BYTES = 5 * 1024 * 1024

export function getLogPath(): string {
  return logPath
}

function stamp(): string {
  return new Date().toISOString()
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || a.message
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

function write(line: string): void {
  try {
    stream?.write(`${stamp()} ${line}\n`)
  } catch {
    /* best-effort logging — never throw from a log call */
  }
}

// Append a single line from outside (e.g. the renderer over IPC).
export function appendLog(line: string): void {
  write(line)
}

export function initLogger(): void {
  if (stream) return
  logPath = join(app.getPath('userData'), 'debug.log')
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_BYTES) {
      renameSync(logPath, `${logPath}.1`)
    }
  } catch {
    /* ignore rotation failure */
  }
  stream = createWriteStream(logPath, { flags: 'a' })
  write(`===== session start ${stamp()} v${app.getVersion()} =====`)

  // Tee console.* so every existing main-process log call also lands in the
  // file, without having to rewrite each call site.
  ;(['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      orig(...args)
      write(`[${level}] ${fmt(args)}`)
    }
  })

  process.on('uncaughtException', (err) => write(`[uncaughtException] ${err?.stack || err}`))
  process.on('unhandledRejection', (reason) =>
    write(`[unhandledRejection] ${reason instanceof Error ? reason.stack : String(reason)}`)
  )
}
