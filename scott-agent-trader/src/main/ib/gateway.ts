import { spawn, execFile } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import net from 'net'

// Phase 1 of "把 IB Gateway 包進來": on app start, if no IB API port is open and
// no Gateway/TWS process is already running, auto-launch IB Gateway so the user
// only opens ONE app. They still log in manually in Gateway's own window (the
// auto-login via IBC is Phase 2). All probes are guarded so we never spawn a
// duplicate login window.

// Common install roots, relative to a drive. IB installs Gateway into a version
// sub-folder (e.g. <root>\1047\ibgateway.exe), or the exe sits directly in the
// folder; exeInDir() handles both. An override via env wins over everything.
const REL_BASES = [
  'Jts\\ibgateway',
  'IBKR\\ibgateway',
  'Jts',
  'IBKR',
  'Program Files\\IBKR',
  'Program Files\\IB Gateway',
  'Program Files (x86)\\IBKR'
]
const DRIVES = ['C', 'D', 'E', 'F']
// Live Gateway 4001, paper Gateway 4002, live TWS 7496, paper TWS 7497.
const API_PORTS = [4001, 4002, 7496, 7497]

export interface GatewayLaunchResult {
  launched: boolean
  reason: string
  exe?: string
}

// ibgateway.exe directly in `dir`, else the newest version sub-folder's exe.
function exeInDir(dir: string): string | null {
  const direct = join(dir, 'ibgateway.exe')
  if (existsSync(direct)) return direct
  if (!existsSync(dir)) return null
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const versions = entries
    .filter((e) => {
      try {
        return statSync(join(dir, e)).isDirectory() && existsSync(join(dir, e, 'ibgateway.exe'))
      } catch {
        return false
      }
    })
    .sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0))
  return versions.length ? join(dir, versions[0], 'ibgateway.exe') : null
}

// Fast path: explicit override, then every common root on every fixed drive.
function findGatewayExeSync(): string | null {
  const override = process.env.IB_GATEWAY_EXE
  if (override && existsSync(override)) return override
  for (const drive of DRIVES) {
    for (const rel of REL_BASES) {
      const hit = exeInDir(`${drive}:\\${rel}`)
      if (hit) return hit
    }
  }
  return null
}

// Robust path: ask the Windows uninstall registry where IB Gateway was actually
// installed (InstallLocation), so even a fully custom path is found. PowerShell
// one-shot; runs only when the fast scan misses.
function findGatewayExeFromRegistry(): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = [
      "$k='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',",
      "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',",
      "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';",
      'Get-ChildItem $k -EA SilentlyContinue | ForEach-Object {',
      '$p=Get-ItemProperty $_.PSPath -EA SilentlyContinue;',
      "if($p.DisplayName -like 'IB Gateway*' -and $p.InstallLocation){$p.InstallLocation}}"
    ].join('')
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const locs = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
        const hits = locs.map((l) => exeInDir(l)).filter((h): h is string => h !== null)
        // Prefer the highest version folder among matches.
        hits.sort((a, b) => {
          const va = parseInt(a.split('\\').slice(-2, -1)[0] || '0', 10) || 0
          const vb = parseInt(b.split('\\').slice(-2, -1)[0] || '0', 10) || 0
          return vb - va
        })
        resolve(hits[0] ?? null)
      }
    )
  })
}

export async function findGatewayExe(): Promise<string | null> {
  return findGatewayExeSync() ?? (await findGatewayExeFromRegistry())
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (v: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(600)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function anyIbPortOpen(): Promise<boolean> {
  for (const p of API_PORTS) {
    if (await isPortOpen(p)) return true
  }
  return false
}

function isProcessRunning(image: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${image}`, '/NH', '/FO', 'CSV'],
      (err, stdout) => {
        if (err) return resolve(false)
        resolve(stdout.toLowerCase().includes(image.toLowerCase()))
      }
    )
  })
}

// Minimize the IB Gateway window so the user only sees the trader app. Targets
// any window whose process is ibgateway OR whose title starts with "IB Gateway"
// (the visible window may belong to the bundled Java runtime). SW_MINIMIZE = 6
// keeps it on the taskbar so it can still be restored for re-auth.
export function minimizeGateway(): void {
  const ps = [
    "Add-Type -Name W -Namespace N -MemberDefinition",
    "'[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int c);';",
    'Get-Process -ErrorAction SilentlyContinue |',
    "Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -eq 'ibgateway' -or $_.MainWindowTitle -like 'IB Gateway*') } |",
    'ForEach-Object { [N.W]::ShowWindow($_.MainWindowHandle, 6) | Out-Null }'
  ].join(' ')
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { timeout: 8000, windowsHide: true },
    (err) => {
      if (err) console.warn('[Gateway] minimize failed:', err.message)
      else console.log('[Gateway] minimized IB Gateway window')
    }
  )
}

let launchInFlight = false

// Spawn IB Gateway only if it isn't already up. Returns why it did / didn't.
export async function ensureGatewayRunning(): Promise<GatewayLaunchResult> {
  if (launchInFlight) return { launched: false, reason: 'in-flight' }
  if (await anyIbPortOpen()) return { launched: false, reason: 'api-open' }
  if (await isProcessRunning('ibgateway.exe')) return { launched: false, reason: 'already-running' }
  if (await isProcessRunning('tws.exe')) return { launched: false, reason: 'tws-running' }

  const exe = await findGatewayExe()
  if (!exe) return { launched: false, reason: 'not-found' }

  try {
    launchInFlight = true
    // Detached + unref so closing the trader app does NOT kill Gateway, and
    // Gateway keeps the API session alive independently.
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: dirname(exe) })
    child.unref()
    console.log(`[Gateway] Launched IB Gateway: ${exe}`)
    return { launched: true, reason: 'spawned', exe }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[Gateway] Launch failed: ${msg}`)
    return { launched: false, reason: `error:${msg}` }
  } finally {
    // Brief lock so two near-simultaneous calls (startup + manual button) don't
    // double-spawn before the process shows up in tasklist.
    setTimeout(() => {
      launchInFlight = false
    }, 5000)
  }
}
