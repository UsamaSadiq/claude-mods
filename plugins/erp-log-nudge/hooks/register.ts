import type { EngineInterface, Register } from 'claude-code'

import { isNudgeTime, localDate, nudgeText, readDay, reportText, settingsOf } from './nudge'
import type { DayLog, Settings } from './nudge'

const CHECK_EVERY_MS = 15 * 60_000
const NUDGE_TOAST_MS = 20_000

const skipFailedRun = () => undefined

const inBackground = (run: Promise<unknown>): void => void run.catch(skipFailedRun)

const nudgedKey = (date: string): string => `nudged:${date}`

const dayLog = async ($: EngineInterface, settings: Settings, date: string): Promise<DayLog> => {
  const result = await $.mcp.call(settings.server, 'timelogs_get_day', { date }).catch(() => undefined)
  return result ? readDay(result) : { kind: 'unknown' }
}

const nudgeOnce = async ($: EngineInterface, settings: Settings) => {
  const clock = await $.clock.now()
  if (!isNudgeTime(clock, settings)) return
  const date = localDate(clock)
  if (await $.store.get(nudgedKey(date))) return
  const day = await dayLog($, settings, date)
  const text = nudgeText(day, settings.skill)
  await $.store.set(nudgedKey(date), true)
  if (text === undefined) return
  $.ui.toast(text, { timeoutMs: NUDGE_TOAST_MS })
}

const checkNow = async ($: EngineInterface, settings: Settings): Promise<string> => {
  const date = localDate(await $.clock.now())
  return reportText(await dayLog($, settings, date), settings.skill)
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(CHECK_EVERY_MS, () => inBackground(nudgeOnce($, settings)))
    await $.command
      .register({ name: 'erp-nudge', description: "Check whether today's ERP time log is filled" })
      .catch(skipFailedRun)
    inBackground(nudgeOnce($, settings))
    return started
  })

  on('command.run', { command: 'erp-nudge' }, async $ => ({ text: await checkNow($, settings) }))
}
