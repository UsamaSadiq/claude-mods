import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_SETTINGS, isDue, resumeTime, settingsOf, shouldArmAfter, waitLabel } from '../hooks/limit'

const NOW = Date.parse('2026-10-11T10:00:00Z')
const HOUR = 3_600_000
const at = (ms: number): string => new Date(ms).toISOString()

describe('limit', () => {
  test('waits for an exhausted window and adds the buffer', () => {
    const windows = [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(NOW + HOUR) }]
    expect(resumeTime(windows, NOW, DEFAULT_SETTINGS)).toBe(NOW + HOUR + 45_000)
  })

  test('ignores windows with room left', () => {
    expect(resumeTime([{ kind: 'five_hour', percentUsed: 97.5, resetsAt: at(NOW + HOUR) }], NOW, DEFAULT_SETTINGS)).toBeUndefined()
  })

  test('waits for the latest of several exhausted windows', () => {
    const windows = [
      { kind: 'five_hour', percentUsed: 100, resetsAt: at(NOW + HOUR) },
      { kind: 'spend_limit', percentUsed: 120, resetsAt: at(NOW + 2 * HOUR) },
    ]
    expect(resumeTime(windows, NOW, DEFAULT_SETTINGS)).toBe(NOW + 2 * HOUR + 45_000)
  })

  test('does not wait for a window that resets too far away', () => {
    const weekly = [{ kind: 'seven_day', percentUsed: 100, resetsAt: at(NOW + 30 * HOUR) }]
    expect(resumeTime(weekly, NOW, DEFAULT_SETTINGS)).toBeUndefined()
  })

  test('ignores a window whose reset has passed or is unknown', () => {
    expect(resumeTime([{ kind: 'five_hour', percentUsed: 100, resetsAt: at(NOW - HOUR) }], NOW, DEFAULT_SETTINGS)).toBeUndefined()
    expect(resumeTime([{ kind: 'five_hour', percentUsed: 100 }], NOW, DEFAULT_SETTINGS)).toBeUndefined()
  })

  test('only a failed main-loop turn arms it', () => {
    expect(shouldArmAfter({ reason: 'error' })).toBe(true)
    expect(shouldArmAfter({ reason: 'answer' })).toBe(false)
    expect(shouldArmAfter({ reason: 'error', agentId: 'sub' })).toBe(false)
  })

  test('is due only for the armed target', () => {
    expect(isDue(5_000, 5_000, 5_000)).toBe(true)
    expect(isDue(5_000, 0, 5_000)).toBe(false)
    expect(isDue(5_000, 9_000, 5_000)).toBe(false)
  })

  test('reads settings and labels waits', () => {
    expect(settingsOf({ message: ' go on ', bufferSeconds: 10, maxWaitHours: 2 })).toEqual({ message: 'go on', bufferMs: 10_000, maxWaitMs: 2 * HOUR })
    expect(settingsOf({ message: '   ' }).message).toBe('continue')
    expect([20_000, 25 * 60_000, 95 * 60_000].map(waitLabel)).toEqual(['1m', '25m', '1h 35m'])
  })
})

const stubEngine = (on: On, { usedPercent = 100 } = {}) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const submitted: string[] = []
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-a' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { rateLimits: [{ kind: 'five_hour', percentUsed: usedPercent, resetsAt: at(NOW + HOUR) }] },
  } as never))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => {
    if (e.origin.kind !== 'composer') submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { clock, submitted, toasts }
}

const failedTurn = { answer: '', durationMs: 100, isAborted: false, turnId: 't1', reason: 'error' as const }

describe('hook', () => {
  test('arms after a failed turn with an exhausted window and says when it will resume', async ($, on) => {
    const { clock, toasts } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.complete(failedTurn)
    await clock.settle()
    expect(toasts[0]).toMatch(/Will send "continue" in 1h 01m/)
  })

  test('stays idle when the failure was not the limit', async ($, on) => {
    const { clock, submitted, toasts } = stubEngine(on, { usedPercent: 40 })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.complete(failedTurn)
    await clock.advance(2 * HOUR)
    expect(toasts).toEqual([])
    expect(submitted).toEqual([])
  })

  test('sends the resume message once, after the reset', async ($, on) => {
    const { clock, submitted } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.complete(failedTurn)
    await clock.advance(HOUR)
    expect(submitted).toEqual([])
    await clock.advance(60_000)
    expect(submitted).toEqual(['continue'])
    await clock.advance(HOUR)
    expect(submitted).toEqual(['continue'])
  })

  test('typing a prompt cancels the pending resume', async ($, on) => {
    const { clock, submitted } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.complete(failedTurn)
    await clock.settle()
    await $.prompt.submit({ text: 'wait, change of plan', wait: false, origin: { kind: 'composer' } })
    await clock.advance(2 * HOUR)
    expect(submitted).toEqual([])
  })

  test('/session-resume cancel stops it too', async ($, on) => {
    const { clock, submitted } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.turn.complete(failedTurn)
    await clock.settle()
    const ran = await $.command.run({ command: 'session-resume', args: 'cancel', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(ran.text).toBe('session-resume cancelled.')
    await clock.advance(2 * HOUR)
    expect(submitted).toEqual([])
  })
})
