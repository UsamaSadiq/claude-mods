import type { UsageWindow } from '../types'

const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Session',
  seven_day: 'Weekly',
  spend_limit: 'Spend',
}

const WINDOW_ORDER = ['five_hour', 'seven_day']

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const WAITING_SUMMARY = 'Usage: waiting for the first reading'

export const windowLabel = (kind: string): string => WINDOW_LABELS[kind] ?? kind

const orderOf = (kind: string): number => {
  const index = WINDOW_ORDER.indexOf(kind)
  return index === -1 ? WINDOW_ORDER.length : index
}

export const orderWindows = (windows: readonly UsageWindow[]): UsageWindow[] =>
  windows.toSorted((a, b) => orderOf(a.kind) - orderOf(b.kind))

export const formatPercent = (percentUsed: number): string => `${Math.round(percentUsed)}%`

export const timeUntil = (resetsAt: string | undefined, now: number): string | undefined => {
  if (resetsAt === undefined) return undefined
  const remaining = Date.parse(resetsAt) - now
  if (Number.isNaN(remaining)) return undefined
  if (remaining < MINUTE) return '<1m'
  if (remaining >= DAY) return `${Math.floor(remaining / DAY)}d ${Math.floor((remaining % DAY) / HOUR)}h`
  if (remaining >= HOUR) return `${Math.floor(remaining / HOUR)}h ${Math.floor((remaining % HOUR) / MINUTE)}m`
  return `${Math.floor(remaining / MINUTE)}m`
}

const windowSummary = (window: UsageWindow, now: number): string => {
  const head = `${windowLabel(window.kind)} ${formatPercent(window.percentUsed)}`
  const resetsIn = timeUntil(window.resetsAt, now)
  return resetsIn ? `${head} · ${resetsIn}` : head
}

const SEGMENT_MARK = '*'

export const usageSegments = (windows: readonly UsageWindow[], now: number): string[] =>
  windows.length === 0 ? [WAITING_SUMMARY] : orderWindows(windows).map(window => windowSummary(window, now))

export const hintTail = (windows: readonly UsageWindow[], now: number): string =>
  usageSegments(windows, now)
    .map(segment => `${SEGMENT_MARK} ${segment}`)
    .join('  ')
