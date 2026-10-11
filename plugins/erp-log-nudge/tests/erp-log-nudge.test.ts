import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_SETTINGS, isNudgeTime, isWorkday, nudgeText, readDay, reportText, settingsOf } from '../hooks/nudge'

const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime()
const FRIDAY_EVENING = at(9, 21)
const FRIDAY_MORNING = at(9, 10)
const SATURDAY_EVENING = at(10, 21)

const text = (body: string, isError = false) => ({ isError, content: [{ type: 'text', text: body }] })

describe('schedule', () => {
  test('nudges only on weekdays at or after the hour', () => {
    expect(isWorkday(FRIDAY_EVENING)).toBe(true)
    expect(isWorkday(SATURDAY_EVENING)).toBe(false)
    expect(isNudgeTime(FRIDAY_EVENING, DEFAULT_SETTINGS)).toBe(true)
    expect(isNudgeTime(FRIDAY_MORNING, DEFAULT_SETTINGS)).toBe(false)
    expect(isNudgeTime(SATURDAY_EVENING, DEFAULT_SETTINGS)).toBe(false)
  })

  test('an hour of -1 turns nudges off', () => {
    expect(isNudgeTime(FRIDAY_EVENING, settingsOf({ nudgeHour: -1 }))).toBe(false)
  })
})

describe('reading a day', () => {
  test('sums the hours of every task', () => {
    const body = JSON.stringify({ projects: [{ tasks: [{ hours: 2 }, { hours: 1.5 }] }] })
    expect(readDay(text(body))).toEqual({ kind: 'logged', hours: 3.5 })
  })

  test('trusts the total the ERP reports', () => {
    const day = { status: 'success', data: { projects: [{ tasks: [{ hours: 1, minutes: 30, decimal_hours: 1.5 }] }], total_logged_time: { hours: 1, minutes: 30, decimal_hours: 1.5 } } }
    expect(readDay(text(JSON.stringify(day)))).toEqual({ kind: 'logged', hours: 1.5 })
    const empty = { status: 'success', data: { projects: [], total_logged_time: { hours: 0, minutes: 0, decimal_hours: 0 } } }
    expect(readDay(text(JSON.stringify(empty)))).toEqual({ kind: 'empty' })
  })

  test('a readable day without hours is empty', () => {
    expect(readDay(text(JSON.stringify({ projects: [] })))).toEqual({ kind: 'empty' })
  })

  test('errors and prose are unknown, never empty', () => {
    expect(readDay(text('boom', true))).toEqual({ kind: 'unknown' })
    expect(readDay(text('no tasks today'))).toEqual({ kind: 'unknown' })
  })

  test('words the nudge by what was found', () => {
    expect(nudgeText({ kind: 'logged', hours: 8 }, '/generate-erp-logs')).toBeUndefined()
    expect(nudgeText({ kind: 'empty' }, '/generate-erp-logs')).toMatch(/nothing logged.*\/generate-erp-logs/)
    expect(nudgeText({ kind: 'unknown' }, '/generate-erp-logs')).toMatch(/could not check/)
    expect(reportText({ kind: 'logged', hours: 8 }, '/x')).toBe('ERP: 8h logged for today.')
  })
})

const stubEngine = (on: On, { start = FRIDAY_EVENING, day = '{"projects":[]}', fails = false } = {}) => {
  const clock = mock.clock(on, { now: start })
  mock.store(on)
  const toasts: string[] = []
  const calls: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('mcp.call', (_$, e) => {
    calls.push(`${e.server}:${e.tool}:${String((e.args as { date: string }).date)}`)
    if (fails) throw new Error('not connected')
    return { value: text(day) } as never
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, toasts, calls }
}

describe('hook', () => {
  test('nudges once when today is empty', async ($, on) => {
    const { clock, toasts, calls } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await clock.advance(16 * 60_000)
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/nothing logged/)
    expect(calls[0]).toBe('claude_ai_ERP_MCP:timelogs_get_day:2026-10-09')
  })

  test('stays quiet once hours are logged', async ($, on) => {
    const { clock, toasts } = stubEngine(on, { day: '{"tasks":[{"hours":8}]}' })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await clock.advance(16 * 60_000)
    expect(toasts).toEqual([])
  })

  test('stays quiet in the morning and at the weekend', async ($, on) => {
    const morning = stubEngine(on, { start: FRIDAY_MORNING })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await morning.clock.settle()
    expect(morning.toasts).toEqual([])
  })

  test('still nudges, wording it as unchecked, when the connector is down', async ($, on) => {
    const { clock, toasts } = stubEngine(on, { fails: true })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await clock.settle()
    expect(toasts[0]).toMatch(/could not check/)
  })

  test('/erp-nudge reports on demand', async ($, on) => {
    stubEngine(on, { day: '{"tasks":[{"hours":6}]}' })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    const ran = await $.command.run({ command: 'erp-nudge', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(ran.text).toBe('ERP: 6h logged for today.')
  })
})
