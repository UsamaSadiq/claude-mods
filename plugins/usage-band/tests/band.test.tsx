import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { gaugeCells, orderWindows, timeUntil, toneOf, usageGauges, WAITING_SUMMARY } from '../hooks/format'

const NOW = Date.parse('2026-10-09T12:00:00Z')

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { bodyRows: 5 } } as never,
} as const

const RATE_LIMITS = [
  { kind: 'seven_day', percentUsed: 43.4, resetsAt: '2026-10-14T09:00:00Z' },
  { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-09T16:02:00Z' },
]

describe('format', () => {
  test('reset countdown reads in days, hours and minutes', () => {
    expect(timeUntil('2026-10-12T16:00:00Z', NOW)).toBe('3d 4h')
    expect(timeUntil('2026-10-09T14:13:00Z', NOW)).toBe('2h 13m')
    expect(timeUntil('2026-10-09T12:07:30Z', NOW)).toBe('7m')
    expect(timeUntil('2026-10-09T11:00:00Z', NOW)).toBe('<1m')
    expect(timeUntil(undefined, NOW)).toBeUndefined()
    expect(timeUntil('not a date', NOW)).toBeUndefined()
  })

  test('session comes before weekly, unknown windows last', () => {
    const kinds = orderWindows([{ kind: 'spend_limit', percentUsed: 1 }, ...RATE_LIMITS]).map(w => w.kind)
    expect(kinds).toEqual(['five_hour', 'seven_day', 'spend_limit'])
  })

  test('gauge fills in eighths and stays inside its bounds', () => {
    expect(gaugeCells(0)).toBe('▱▱▱▱▱▱▱▱')
    expect(gaugeCells(50)).toBe('▰▰▰▰▱▱▱▱')
    expect(gaugeCells(100)).toBe('▰▰▰▰▰▰▰▰')
    expect(gaugeCells(250)).toBe('▰▰▰▰▰▰▰▰')
    expect(gaugeCells(-5)).toBe('▱▱▱▱▱▱▱▱')
  })

  test('tone warns from 70% and alarms from 90%', () => {
    expect([toneOf(10), toneOf(70), toneOf(89), toneOf(90)]).toEqual(['success', 'warning', 'warning', 'error'])
  })

  test('gauges read session then weekly with reset countdowns', () => {
    expect(usageGauges(RATE_LIMITS, NOW)).toEqual([
      { label: 'Session', cells: '▰▱▱▱▱▱▱▱', percent: '12%', tone: 'success', resetsIn: '4h 2m' },
      { label: 'Weekly', cells: '▰▰▰▱▱▱▱▱', percent: '43%', tone: 'success', resetsIn: '4d 21h' },
    ])
  })

  test('a gauge leaves out a countdown it cannot read', () => {
    expect(usageGauges([{ kind: 'five_hour', percentUsed: 7 }], NOW)[0]?.resetsIn).toBeUndefined()
  })

  test('no windows means no gauges', () => {
    expect(usageGauges([], NOW)).toEqual([])
  })
})

const stubEngine = (on: On) => {
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
}

describe('band above the prompt', () => {
  test('waits for the first reading', async ($, on) => {
    stubEngine(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: WAITING_SUMMARY })).toBeDefined()
      await ui.unmount()
    }
  })

  test('shows session and weekly gauges once measured', async ($, on) => {
    stubEngine(on)
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ context: { window: 200_000 }, rateLimits: RATE_LIMITS, changed: ['rateLimits'] })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: 'Session ' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '▰▰▰▱▱▱▱▱' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: / 43%/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('yields to a survey', async ($, on) => {
    stubEngine(on)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Text', text: WAITING_SUMMARY })).toBeUndefined()
    await ui.unmount()
  })
})
