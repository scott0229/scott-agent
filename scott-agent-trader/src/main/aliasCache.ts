import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

function getCacheFilePath(port: number): string {
  return join(app.getPath('userData'), `alias-cache-${port}.json`)
}

export function getCachedAliases(port: number): Record<string, string> {
  try {
    const filePath = getCacheFilePath(port)
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      console.log(`[AliasCache] Loaded cached aliases for port ${port}:`, Object.keys(data).length, 'accounts')
      // Handle old format (objects with alias+accountType) by extracting alias
      const result: Record<string, string> = {}
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          result[key] = value
        } else if (value && typeof value === 'object' && 'alias' in value) {
          result[key] = (value as { alias: string }).alias
        }
      }
      return result
    }
  } catch (err) {
    console.error('[AliasCache] Error reading cache:', err)
  }
  return {}
}

export function setCachedAliases(aliases: Record<string, string>, port: number): void {
  try {
    const filePath = getCacheFilePath(port)
    // Merge with existing cache (don't lose aliases for accounts not in current batch)
    const existing = getCachedAliases(port)
    const merged = { ...existing, ...aliases }
    writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log(`[AliasCache] Saved aliases for port ${port}:`, Object.keys(merged).length, 'accounts')
  } catch (err) {
    console.error('[AliasCache] Error writing cache:', err)
  }
}
