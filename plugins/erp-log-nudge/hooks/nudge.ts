export type Settings = { nudgeHour: number; server: string; skill: string }

export const DEFAULT_SETTINGS: Settings = { nudgeHour: 20, server: 'claude_ai_ERP_MCP', skill: '/generate-erp-logs' }

export const NO_NUDGES = -1

const pad = (n: number): string => String(n).padStart(2, '0')

export const settingsOf = (options: Record<string, unknown>): Settings => ({
  nudgeHour: Number(options.nudgeHour ?? DEFAULT_SETTINGS.nudgeHour),
  server: String(options.server ?? DEFAULT_SETTINGS.server).trim() || DEFAULT_SETTINGS.server,
  skill: String(options.skill ?? DEFAULT_SETTINGS.skill).trim() || DEFAULT_SETTINGS.skill,
})

export const localDate = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const isWorkday = (ms: number): boolean => {
  const day = new Date(ms).getDay()
  return day !== 0 && day !== 6
}

export const isNudgeTime = (ms: number, settings: Settings): boolean =>
  settings.nudgeHour !== NO_NUDGES && isWorkday(ms) && new Date(ms).getHours() >= settings.nudgeHour

type Json = unknown

const HOURS_KEY = /hour/i

const hoursIn = (value: Json, key = ''): number => {
  if (typeof value === 'number') return HOURS_KEY.test(key) ? value : 0
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + hoursIn(item, key), 0)
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((sum, [name, item]) => sum + hoursIn(item, name), 0)
  }
  return 0
}

const parsed = (text: string): Json | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const reportedTotal = (data: Json): number | undefined => {
  const total = (data as { data?: { total_logged_time?: { decimal_hours?: unknown } } } | null)?.data?.total_logged_time?.decimal_hours
  return typeof total === 'number' ? total : undefined
}

export type DayLog = { kind: 'logged'; hours: number } | { kind: 'empty' } | { kind: 'unknown' }

export const readDay = (result: { isError: boolean; content: readonly { type: string; text?: string }[] }): DayLog => {
  if (result.isError) return { kind: 'unknown' }
  const text = result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
  const data = parsed(text)
  if (data === undefined) return { kind: 'unknown' }
  const hours = reportedTotal(data) ?? hoursIn(data)
  return hours > 0 ? { kind: 'logged', hours } : { kind: 'empty' }
}

export const nudgeText = (day: DayLog, skill: string): string | undefined => {
  if (day.kind === 'logged') return undefined
  if (day.kind === 'empty') return `ERP: nothing logged for today yet. Run ${skill} before you sign off.`
  return `ERP: could not check today's log. If it is still empty, run ${skill}.`
}

export const reportText = (day: DayLog, skill: string): string =>
  day.kind === 'logged' ? `ERP: ${day.hours}h logged for today.` : (nudgeText(day, skill) ?? '')
