import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { assetOf, isQuietEnough, isShipping, MIN_GAP_MS, ringtoneForTurn } from '../hooks/sounds'

const SECOND = 1_000

const stubEngine = (on: On, { toolResult = { result: { stdout: '', stderr: '' } } as object } = {}) => {
  const played: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('audio.play', (_$, e) => {
    if (e.clip.asset !== undefined) played.push(e.clip.asset)
    return { value: undefined }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', () => toolResult as never)
  return { played, clock }
}

describe('sounds', () => {
  test('chimes only for long main-loop answers and for errors', () => {
    expect(ringtoneForTurn({ reason: 'answer', durationMs: 30 * SECOND }, 20 * SECOND)).toBe('done')
    expect(ringtoneForTurn({ reason: 'answer', durationMs: 5 * SECOND }, 20 * SECOND)).toBeUndefined()
    expect(ringtoneForTurn({ reason: 'error', durationMs: SECOND }, 20 * SECOND)).toBe('oops')
    expect(ringtoneForTurn({ reason: 'aborted', durationMs: 60 * SECOND }, 20 * SECOND)).toBeUndefined()
    expect(ringtoneForTurn({ agentId: 'sub', reason: 'answer', durationMs: 60 * SECOND }, 20 * SECOND)).toBeUndefined()
  })

  test('recognises pushes and merges as shipping', () => {
    expect(isShipping({ tool: 'Bash', command: 'git push origin main' })).toBe(true)
    expect(isShipping({ tool: 'Bash', command: 'gh pr merge 4 --squash' })).toBe(true)
    expect(isShipping({ tool: 'Bash', command: 'git status' })).toBe(false)
    expect(isShipping({ tool: 'Edit' })).toBe(false)
  })

  test('debounces and maps names to the plugin assets', () => {
    expect(isQuietEnough(1_000, 1_000 + MIN_GAP_MS - 1)).toBe(false)
    expect(isQuietEnough(1_000, 1_000 + MIN_GAP_MS)).toBe(true)
    expect(assetOf('ship')).toBe('sounds/ship.wav')
  })
})

describe('hooks', () => {
  test('plays the done chime after a long turn', async ($, on) => {
    const { played, clock } = stubEngine(on)
    await $.turn.complete({ answer: 'ok', durationMs: 45 * SECOND, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(played).toEqual(['sounds/done.wav'])
  })

  test('stays quiet after a short turn', async ($, on) => {
    const { played, clock } = stubEngine(on)
    await $.turn.complete({ answer: 'ok', durationMs: 3 * SECOND, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(played).toEqual([])
  })

  test('rings the ship fanfare after a push', async ($, on) => {
    const { played, clock } = stubEngine(on)
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await clock.settle()
    expect(played).toEqual(['sounds/ship.wav'])
  })

  test('does not ring twice inside the debounce window', async ($, on) => {
    const { played, clock } = stubEngine(on)
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await clock.settle()
    await clock.advance(500)
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await clock.settle()
    await clock.advance(MIN_GAP_MS)
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await clock.settle()
    expect(played).toEqual(['sounds/ship.wav', 'sounds/ship.wav'])
  })

  test('buzzes when a call is blocked', async ($, on) => {
    const { played, clock } = stubEngine(on, { toolResult: { deny: 'nope' } })
    await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })
    await clock.settle()
    expect(played).toEqual(['sounds/blocked.wav'])
  })

  test('muted: plays nothing', { options: { isMuted: true } }, async ($, on) => {
    const { played, clock } = stubEngine(on)
    await $.turn.complete({ answer: 'ok', durationMs: 45 * SECOND, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.settle()
    expect(played).toEqual([])
  })
})
