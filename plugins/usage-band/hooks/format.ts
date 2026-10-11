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

const GAUGE_CELLS = 8
const FILLED_CELL = '▰'
const EMPTY_CELL = '▱'

export type Tone = 'success' | 'warning' | 'error'

export type Gauge = { label: string; cells: string; percent: string; tone: Tone; resetsIn?: string }

export const gaugeCells = (percentUsed: number): string => {
  const filled = Math.min(GAUGE_CELLS, Math.max(0, Math.round((percentUsed / 100) * GAUGE_CELLS)))
  return FILLED_CELL.repeat(filled) + EMPTY_CELL.repeat(GAUGE_CELLS - filled)
}

export const toneOf = (percentUsed: number): Tone => {
  if (percentUsed >= 90) return 'error'
  if (percentUsed >= 70) return 'warning'
  return 'success'
}

const toGauge = (window: UsageWindow, now: number): Gauge => ({
  label: windowLabel(window.kind),
  cells: gaugeCells(window.percentUsed),
  percent: formatPercent(window.percentUsed),
  tone: toneOf(window.percentUsed),
  resetsIn: timeUntil(window.resetsAt, now),
})

export const usageGauges = (windows: readonly UsageWindow[], now: number): Gauge[] =>
  orderWindows(windows).map(window => toGauge(window, now))
