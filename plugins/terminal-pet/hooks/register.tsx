import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Counters, Moments } from '../types'
import { afterPrompt, faceOf, levelOf, moodOf, withoutPet, withPet } from './pet'
import { report, reportLines } from './report'
import { addCounters, countPrompt, countTool, countTurn, emptyCounters, isEmpty, sumCounters, toolKind, xpOf } from './stats'
import type { ToolOutcome } from './stats'
import { localDate, localHour } from './time'

const TICK_MS = 60_000
const DEFAULT_REPORT_HOUR = 18
const NO_REPORT = -1
const REPORT_TOAST_MS = 20_000
const DAY_KEY_PREFIX = 'day:'

const NO_MOMENTS: Moments = { lastCelebration: 0, lastDenial: 0, streakStart: 0, lastPrompt: 0 }

const day = atom({ plugin: 'terminal-pet', key: 'day' } as const, '')
const counters = atom({ plugin: 'terminal-pet', key: 'counters' } as const, emptyCounters())
const othersToday = atom({ plugin: 'terminal-pet', key: 'othersToday' } as const, emptyCounters())
const pastXp = atom({ plugin: 'terminal-pet', key: 'pastXp' } as const, 0)
const moments = atom({ plugin: 'terminal-pet', key: 'moments' } as const, NO_MOMENTS)
const suggestion = atom({ plugin: 'terminal-pet', key: 'suggestion' } as const, '')
const shownFace = atom({ plugin: 'terminal-pet', key: 'shownFace' } as const, '')

type DayRecord = Record<string, Counters>

const dayKey = (date: string): string => `${DAY_KEY_PREFIX}${date}`
const reportShownKey = (date: string): string => `report-shown:${date}`

const readDay = async ($: EngineInterface, date: string): Promise<DayRecord> =>
  ((await $.store.get(dayKey(date))) as DayRecord | undefined) ?? {}

const othersIn = (record: DayRecord, sessionId: string): Counters =>
  sumCounters(Object.entries(record).filter(([id]) => id !== sessionId).map(([, counted]) => counted))

const persist = async ($: EngineInterface) => {
  const [date, mine, sessionId] = await Promise.all([read($, day), read($, counters), $.session.id()])
  if (!date) return
  const record = await readDay($, date)
  await $.store.set(dayKey(date), { ...record, [sessionId]: mine })
  await update($, othersToday, () => othersIn(record, sessionId))
}

const loadHistory = async ($: EngineInterface, today: string) => {
  const sessionId = await $.session.id()
  const pastDays = (await $.store.keys()).filter(key => key.startsWith(DAY_KEY_PREFIX) && key !== dayKey(today))
  const pastRecords = await Promise.all(pastDays.map(key => $.store.get(key) as Promise<DayRecord>))
  const todayRecord = await readDay($, today)
  const xp = pastRecords.reduce((total, record) => total + xpOf(sumCounters(Object.values(record))), 0)
  const resumed = todayRecord[sessionId]
  await Promise.all([
    update($, day, () => today),
    update($, pastXp, () => xp),
    update($, othersToday, () => othersIn(todayRecord, sessionId)),
    update($, counters, current => (isEmpty(current) && resumed ? resumed : current)),
  ])
}

const rollOverIfNewDay = async ($: EngineInterface, clock: number) => {
  const [date, mine, others] = await Promise.all([read($, day), read($, counters), read($, othersToday)])
  const today = localDate(clock)
  if (!date || date === today) return
  await persist($)
  await Promise.all([
    update($, pastXp, xp => xp + xpOf(addCounters(mine, others))),
    update($, counters, () => emptyCounters()),
    update($, othersToday, () => emptyCounters()),
    update($, day, () => today),
  ])
}

const totals = async ($: EngineInterface) => {
  const [mine, others, past] = await Promise.all([read($, counters), read($, othersToday), read($, pastXp)])
  const today = addCounters(mine, others)
  const xp = past + xpOf(today)
  return { today, xp, level: levelOf(xp) }
}

const currentFace = async ($: EngineInterface): Promise<string> => {
  const [{ level }, current, clock] = await Promise.all([totals($), read($, moments), $.clock.now()])
  return faceOf(moodOf(current, clock), level)
}

const statsReport = async ($: EngineInterface): Promise<string> => {
  const [{ today, xp, level }, face] = await Promise.all([totals($), currentFace($)])
  return report(face, reportLines(today, level, xp))
}

const showPet = async ($: EngineInterface) => {
  const [face, suggested] = await Promise.all([currentFace($), read($, suggestion)])
  await update($, shownFace, () => face)
  await $.prompt.suggest({ text: withPet(face, suggested) })
}

const showPetIfMoodChanged = async ($: EngineInterface) => {
  const [face, shown] = await Promise.all([currentFace($), read($, shownFace)])
  if (face !== shown) await showPet($)
}

const showDailyReportOnce = async ($: EngineInterface, clock: number, reportHour: number) => {
  if (reportHour === NO_REPORT || localHour(clock) < reportHour) return
  const shownKey = reportShownKey(localDate(clock))
  if (await $.store.get(shownKey)) return
  await $.store.set(shownKey, true)
  $.ui.toast(await statsReport($), { timeoutMs: REPORT_TOAST_MS })
}

const tick = async ($: EngineInterface, reportHour: number) => {
  const clock = await $.clock.now()
  await rollOverIfNewDay($, clock)
  await persist($)
  await showDailyReportOnce($, clock, reportHour)
  await showPetIfMoodChanged($)
}

const outcomeOf = (result: ToolCallResult): ToolOutcome => {
  if ('deny' in result && result.deny !== undefined) return 'denied'
  return result.isError ? 'failed' : 'ok'
}

const CELEBRATED = new Set(['push', 'merge'])

const skipFailedRun = () => undefined

const inBackground = (run: Promise<unknown>): void => void run.catch(skipFailedRun)

export const register: Register = (on, options) => {
  const reportHour = Number(options.reportHour ?? DEFAULT_REPORT_HOUR)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(TICK_MS, () => inBackground(tick($, reportHour)))
    const clock = await $.clock.now()
    await loadHistory($, localDate(clock))
    inBackground(showPet($))
    await $.command
      .register({ name: 'pet-stats', description: "Show today's silly stats from your terminal pet" })
      .catch(skipFailedRun)
    await showDailyReportOnce($, clock, reportHour)
    return started
  })

  on('session.end', async ($, e, next) => {
    await persist($)
    return next(e)
  })

  on('command.run', { command: 'pet-stats' }, async $ => ({ text: await statsReport($) }))

  on('prompt.suggest', async ($, e, next) => {
    if (e.origin.kind !== 'suggestion') return next(e)
    await update($, suggestion, () => e.text)
    const face = await currentFace($)
    await update($, shownFace, () => face)
    return next({ ...e, text: withPet(face, e.text) })
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const text = withoutPet(e.text)
    if (text !== e.text && text.trim() === '') return { drop: `${await currentFace($)} is just your pet, not a prompt` }
    await update($, suggestion, () => '')
    if (e.origin.kind !== 'composer') return next({ ...e, text })
    const clock = await $.clock.now()
    await Promise.all([
      update($, counters, current => countPrompt(current, text)),
      update($, moments, current => afterPrompt(current, clock)),
    ])
    return next({ ...e, text })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const kind = toolKind(e)
    const outcome = outcomeOf(result)
    const clock = await $.clock.now()
    await update($, counters, current => countTool(current, kind, outcome))
    if (outcome === 'denied') await update($, moments, current => ({ ...current, lastDenial: clock }))
    if (outcome === 'ok' && CELEBRATED.has(kind)) await update($, moments, current => ({ ...current, lastCelebration: clock }))
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, counters, current => countTurn(current, e.durationMs))
    const completed = await next(e)
    await showPet($).catch(skipFailedRun)
    return completed
  })
}
