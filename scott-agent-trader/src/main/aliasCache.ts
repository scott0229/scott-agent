import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'

function getCacheFilePath(port: number): string {
  return join(app.getPath('userData'), `alias-cache-${port}.json`)
}

// Extract a flat {accountId: alias} map from a cache file's parsed JSON,
// tolerating the legacy {alias, accountType} object format.
function extractAliases(data: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!data || typeof data !== 'object') return result
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value) result[key] = value
    } else if (value && typeof value === 'object' && 'alias' in value) {
      const a = (value as { alias: string }).alias
      if (a) result[key] = a
    }
  }
  return result
}

export function getCachedAliases(port: number): Record<string, string> {
  // IB account ids are GLOBALLY unique, but an account's alias only resolves on
  // the login that exposes it (e.g. the FA master on 7497 delivers
  // AccountOrGroup, while the same account on an individual login like 4001
  // does NOT). So merge every port's cache file — with the requested port
  // taking precedence — so an alias learned on any login shows on all of them.
  const dir = app.getPath('userData')
  const merged: Record<string, string> = {}
  try {
    const requestedFile = `alias-cache-${port}.json`
    const files = readdirSync(dir).filter((f) => /^alias-cache-\d+\.json$/.test(f))
    // Other ports first (lower precedence), requested port last so it wins.
    const ordered = [...files.filter((f) => f !== requestedFile), requestedFile]
    for (const file of ordered) {
      const full = join(dir, file)
      if (!existsSync(full)) continue
      try {
        const data = JSON.parse(readFileSync(full, 'utf-8'))
        Object.assign(merged, extractAliases(data))
      } catch {
        /* skip unreadable/corrupt file */
      }
    }
    console.log(
      `[AliasCache] Loaded cached aliases for port ${port} (merged ${files.length} port files):`,
      Object.keys(merged).length,
      'accounts'
    )
  } catch (err) {
    console.error('[AliasCache] Error reading cache:', err)
  }
  return merged
}

export function setCachedAliases(aliases: Record<string, string>, port: number): void {
  try {
    const filePath = getCacheFilePath(port)
    // Merge with existing cache (don't lose aliases for accounts not in current batch)
    const existing = getCachedAliases(port)
    const merged = { ...existing, ...aliases }
    writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log(
      `[AliasCache] Saved aliases for port ${port}:`,
      Object.keys(merged).length,
      'accounts'
    )
  } catch (err) {
    console.error('[AliasCache] Error writing cache:', err)
  }
}
