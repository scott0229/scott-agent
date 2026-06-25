// Shared helpers for the batch-group "quantity allocation" model.
//
// Background: a symbol group's membership used to be a SET of posKeys
// (`account|symbol|secType|expiry|strike|right`, NO quantity). IB
// aggregates positions to one row per (account, contract), so two groups
// holding the SAME contract in the SAME account had identical posKeys and
// were indistinguishable — rolling one corrupted the other.
//
// The leg model fixes this: each group owns a signed QUANTITY of a given
// (account, contract). Two groups can each claim part of one IB row.
// These helpers are imported by AccountOverview.tsx and AddGroupDialog.tsx
// (which previously each defined their own posKey).

import type { PositionData } from '../hooks/useAccountStore'

// A group's claim on a contract: the contract identity (same fields as a
// posKey) plus a SIGNED quantity (negative = short, matching
// PositionData.quantity). Defined here (not in useTraderSettings) so the
// value helpers below and useTraderSettings both import from one place
// without a runtime import cycle.
export interface GroupLeg {
  account: string
  symbol: string
  secType: string // 'STK' | 'OPT'
  expiry?: string // YYYYMMDD; absent for STK
  strike?: number // absent for STK
  right?: string // 'C'|'P'|'CALL'|'PUT'; absent for STK
  quantity: number // signed claimed qty
}

// Contract identity of a position (legacy "posKey"). NO quantity.
export const posKey = (pos: PositionData): string =>
  `${pos.account}|${pos.symbol}|${pos.secType}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`

// Contract identity of a leg — equals posKey of its matching position.
export const legKey = (l: GroupLeg): string =>
  `${l.account}|${l.symbol}|${l.secType}|${l.expiry || ''}|${l.strike || ''}|${l.right || ''}`

// Normalize a right so 'C'/'CALL' and 'P'/'PUT' compare equal. IB reports
// 'CALL'/'PUT' on positions while dialogs/legs store 'C'/'P'.
const foldRight = (right?: string): string =>
  right === 'C' || right === 'CALL' ? 'C' : right === 'P' || right === 'PUT' ? 'P' : ''

// Match key used to associate a leg with an aggregated IB position. Equal
// contract keys ⇒ same IB row. Folds the right so the C/CALL mismatch
// doesn't break matching.
export const legContractKey = (l: {
  account: string
  symbol: string
  secType: string
  expiry?: string
  strike?: number
  right?: string
}): string =>
  `${l.account}|${l.symbol}|${l.secType}|${l.expiry || ''}|${l.strike || ''}|${foldRight(l.right)}`

export const posContractKey = (p: PositionData): string =>
  `${p.account}|${p.symbol}|${p.secType}|${p.expiry || ''}|${p.strike || ''}|${foldRight(p.right)}`

// Derive the legacy posKeys array from legs (dual-write for back-compat).
// Only non-zero legs contribute; deduped on contract identity.
export const posKeysFromLegs = (legs: GroupLeg[] | undefined): string[] =>
  Array.from(new Set((legs || []).filter((l) => l.quantity !== 0).map((l) => legKey(l))))

// Parse a posKey string back into its component fields.
export const parsePosKey = (
  key: string
): { account: string; symbol: string; secType: string; expiry?: string; strike?: number; right?: string } => {
  const [account, symbol, secType, expiry, strike, right] = key.split('|')
  return {
    account,
    symbol,
    secType,
    expiry: expiry || undefined,
    strike: strike ? Number(strike) : undefined,
    right: right || undefined
  }
}

// Build a leg from a posKey string + claimed signed quantity. When a live
// position matches, copy its exact fields (so strike is a number, right is
// the position's form) and use the requested quantity.
export const legFromKeyAndPos = (
  key: string,
  quantity: number,
  positions: PositionData[]
): GroupLeg => {
  const match = positions.find((p) => posKey(p) === key)
  if (match) {
    return {
      account: match.account,
      symbol: match.symbol,
      secType: match.secType,
      expiry: match.expiry,
      strike: match.strike,
      right: match.right,
      quantity
    }
  }
  const parsed = parsePosKey(key)
  return { ...parsed, quantity }
}
