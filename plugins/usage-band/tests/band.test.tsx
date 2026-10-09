import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hintTail, orderWindows, timeUntil, usageSegments, WAITING_SUMMARY } from '../hooks/format'

const NOW = Date.parse('2026-10-09T12:00:00Z')

const HINT_PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

const RATE_LIMITS = [
  { kind: 'seven_day', percentUsed: 43.4, resetsAt: '2026-10-14T09:00:00Z' },
  { kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-09T16:02:00Z' },
]

const drawHintWithTail = (on: On) =>
  on('ui.render', { component: 'PromptHint' }, (engine, e) => {
    const { Text } = engine.ui.resolve(e)
    return <Text>{`${e.props.hint}   ${e.props.tail ?? ''}`}</Text>
  })

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

  test('summary reads session then weekly with reset countdowns', () => {
    expect(usageSegments(RATE_LIMITS, NOW)).toEqual(['Session 12% · 4h 2m', 'Weekly 43% · 4d 21h'])
  })

  test('summary leaves out a countdown it cannot read', () => {
    expect(usageSegments([{ kind: 'five_hour', percentUsed: 7 }], NOW)).toEqual(['Session 7%'])
  })

  test('summary waits until there is a reading', () => {
    expect(usageSegments([], NOW)).toEqual([WAITING_SUMMARY])
  })
})

describe('tail', () => {
  test('marks each window with a star', () => {
    expect(hintTail(RATE_LIMITS, NOW)).toBe('* Session 12% · 4h 2m  * Weekly 43% · 4d 21h')
  })
})

describe('hint line', () => {
  test('appends the waiting note before the first reading', async ($, on) => {
    drawHintWithTail(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'PromptHint', props: HINT_PROPS })
      expect(await ui.find({ type: 'Text', text: /\? for shortcuts {3}\* Usage: waiting/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('appends session and weekly usage once measured', async ($, on) => {
    drawHintWithTail(on)
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ context: { window: 200_000 }, rateLimits: RATE_LIMITS, changed: ['rateLimits'] })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'PromptHint', props: HINT_PROPS })
      expect(await ui.find({ type: 'Text', text: /\? for shortcuts {3}\* Session 12%.*\* Weekly 43%/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('keeps a tail drawn by a plugin above it in front', async ($, on) => {
    drawHintWithTail(on)
    const props = { ...HINT_PROPS, tail: 'from another mod' }
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'PromptHint', props })
    expect(await ui.find({ type: 'Text', text: /from another mod  \* Usage: waiting/ })).toBeDefined()
    await ui.unmount()
  })
})
