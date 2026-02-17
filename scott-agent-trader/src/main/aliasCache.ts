import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

function getCacheFilePath(): string {
  return join(app.getPath('userData'), 'alias-cache.json')
}

export function getCachedAliases(): Record<string, string> {
  try {
    const filePath = getCacheFilePath()
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      console.log('[AliasCache] Loaded cached aliases:', Object.keys(data).length, 'accounts')
      return data
    }
  } catch (err) {
    console.error('[AliasCache] Error reading cache:', err)
  }
  return {}
}

export function setCachedAliases(aliases: Record<string, string>): void {
  try {
    const filePath = getCacheFilePath()
    // Merge with existing cache (don't lose aliases for accounts not in current batch)
    const existing = getCachedAliases()
    const merged = { ...existing, ...aliases }
    writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log('[AliasCache] Saved aliases:', Object.keys(merged).length, 'accounts')
  } catch (err) {
    console.error('[AliasCache] Error writing cache:', err)
  }
}

