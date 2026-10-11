export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Settings = { message: string; bufferMs: number; maxWaitMs: number }

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
const EXHAUSTED_PERCENT = 100

export const DEFAULT_SETTINGS: Settings = { message: 'continue', bufferMs: 45_000, maxWaitMs: 6 * HOUR_MS }

export const settingsOf = (options: Record<string, unknown>): Settings => ({
  message: String(options.message ?? DEFAULT_SETTINGS.message).trim() || DEFAULT_SETTINGS.message,
  bufferMs: Number(options.bufferSeconds ?? DEFAULT_SETTINGS.bufferMs / 1_000) * 1_000,
  maxWaitMs: Number(options.maxWaitHours ?? DEFAULT_SETTINGS.maxWaitMs / HOUR_MS) * HOUR_MS,
})

const resetTime = (window: Window): number => (window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN)

const isExhausted = (window: Window): boolean => window.percentUsed >= EXHAUSTED_PERCENT

const isPending = (window: Window, now: number): boolean => resetTime(window) > now

export const resumeTime = (windows: readonly Window[], now: number, settings: Settings): number | undefined => {
  const blocking = windows.filter(window => isExhausted(window) && isPending(window, now))
  if (blocking.length === 0) return undefined
  const resetsAt = Math.max(...blocking.map(resetTime))
  return resetsAt - now <= settings.maxWaitMs ? resetsAt + settings.bufferMs : undefined
}

export const shouldArmAfter = (turn: { reason: string; agentId?: string }): boolean =>
  turn.agentId === undefined && turn.reason === 'error'

export const waitLabel = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const isDue = (target: number, armed: number, now: number): boolean => armed === target && now >= target - 1_000
