import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Counters, Moments } from '../types'
import { afterPrompt, faceOf, levelOf, moodOf, withoutPet, withPet } from '../hooks/pet'
import { reportLines } from '../hooks/report'
import { countPrompt, countTool, emptyCounters, toolKind, xpOf } from '../hooks/stats'
import { localDate, localHour } from '../hooks/time'

const at = (hour: number, minute = 0, day = 9): number => new Date(2026, 9, day, hour, minute).getTime()
const NOON = at(12)
const MINUTE = 60_000
const NO_MOMENTS: Moments = { lastCelebration: 0, lastDenial: 0, streakStart: 0, lastPrompt: 0 }

const counted = (overrides: Partial<Counters>): Counters => ({ ...emptyCounters(), ...overrides })

const stubEngine = (on: On, clock = NOON, { refuseCommands = false } = {}) => {
  const store = new Map<string, unknown>()
  const suggested: string[] = []
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'session-a' }))
  on('clock.now', () => ({ value: clock }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', (_$, e) => {
    if (refuseCommands) throw new Error(`/${e.name} is taken`)
    return { value: { command: e.name } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('prompt.suggest', (_$, e) => {
    suggested.push(e.text)
    return { isShown: true }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { store, suggested, toasts }
}

describe('time', () => {
  test('reads dates and hours in local time', () => {
    expect(localHour(NOON)).toBe(12)
    expect(localDate(at(0, 30, 10))).toBe('2026-10-10')
    expect(localDate(at(23, 59))).toBe('2026-10-09')
  })
})

describe('stats', () => {
  test('counts words, continues and pleases in a prompt', () => {
    const after = countPrompt(emptyCounters(), 'continue please, and please hurry')
    expect(after).toMatchObject({ prompts: 1, words: 5, continues: 1, pleases: 2 })
  })

  test('sorts tool calls into commits, pushes, merges and edits', () => {
    expect(toolKind({ tool: 'Bash', command: 'git commit -m "feat: x"' })).toBe('commit')
    expect(toolKind({ tool: 'Bash', command: 'git push origin main' })).toBe('push')
    expect(toolKind({ tool: 'Edit' })).toBe('edit')
    expect(toolKind({ tool: 'Bash', command: 'gh pr merge 42 --squash' })).toBe('merge')
    expect(toolKind({ tool: 'Bash', command: 'ls' })).toBe('other')
  })

  test('counts a success by kind, a denial as a denial, a failure as a plain call', () => {
    expect(countTool(emptyCounters(), 'push', 'ok')).toMatchObject({ toolCalls: 1, pushes: 1 })
    expect(countTool(emptyCounters(), 'push', 'denied')).toMatchObject({ toolCalls: 1, pushes: 0, denials: 1 })
    expect(countTool(emptyCounters(), 'push', 'failed')).toMatchObject({ toolCalls: 1, pushes: 0, denials: 0 })
  })

  test('xp weighs pushes and merged PRs above commits', () => {
    expect(xpOf(counted({ commits: 3, pushes: 2, merged: 1 }))).toBe(12)
  })
})

describe('pet', () => {
  test('levels grow with xp', () => {
    expect([0, 9, 10, 30, 60, 100].map(levelOf)).toEqual([1, 1, 2, 3, 4, 5])
  })

  test('playing beats hissing beats sleep', () => {
    const night = at(0, 0, 10)
    expect(moodOf({ ...NO_MOMENTS, lastCelebration: night - MINUTE, lastDenial: night - MINUTE }, night)).toBe('playing')
    expect(moodOf({ ...NO_MOMENTS, lastDenial: night - MINUTE }, night)).toBe('hissing')
    expect(moodOf(NO_MOMENTS, night)).toBe('sleeping')
  })

  test('yawns late in the evening before sleeping', () => {
    expect(moodOf(NO_MOMENTS, at(21, 30))).toBe('yawning')
    expect(moodOf(NO_MOMENTS, at(23, 30))).toBe('sleeping')
  })

  test('eager while you prompt, resting once you stop, stretching after two hours', () => {
    expect(moodOf({ ...NO_MOMENTS, lastPrompt: NOON - 2 * MINUTE }, NOON)).toBe('eager')
    expect(moodOf({ ...NO_MOMENTS, lastPrompt: NOON - 30 * MINUTE }, NOON)).toBe('resting')
    expect(moodOf({ ...NO_MOMENTS, streakStart: NOON - 121 * MINUTE, lastPrompt: NOON }, NOON)).toBe('stretching')
  })

  test('a fifteen minute gap starts a new streak', () => {
    const working = { ...NO_MOMENTS, streakStart: NOON - 60 * MINUTE, lastPrompt: NOON - 5 * MINUTE }
    expect(afterPrompt(working, NOON).streakStart).toBe(NOON - 60 * MINUTE)
    const back = { ...working, lastPrompt: NOON - 20 * MINUTE }
    expect(afterPrompt(back, NOON).streakStart).toBe(NOON)
  })

  test('the cat earns a star and then a crown', () => {
    expect(faceOf('resting', 1)).toBe('ᓚᘏᗢ resting Lv1')
    expect(faceOf('playing', 3)).toBe('⋆ฅ^•ﻌ•^ฅ~ playing Lv3')
    expect(faceOf('sleeping', 7)).toBe('♔(=-ω-=) zzz Lv7')
  })

  test('rides in front of a suggestion and comes off before sending', () => {
    expect(withPet('ᓚᘏᗢ resting Lv1', 'run the tests')).toBe('ᓚᘏᗢ resting Lv1  run the tests')
    expect(withPet('ᓚᘏᗢ resting Lv1', '')).toBe('ᓚᘏᗢ resting Lv1')
    expect(withoutPet('⋆/ᐠ - ˕ -マ stretch? Lv3  run the tests')).toBe('run the tests')
    expect(withoutPet('/ᐠ｡ꞈ｡ᐟ\\ eager Lv2  run the tests')).toBe('run the tests')
    expect(withoutPet('♔(=-ω-=) zzz Lv7')).toBe('')
    expect(withoutPet('ᓚᘏᗢ is my favourite cat')).toBe('ᓚᘏᗢ is my favourite cat')
  })
})

describe('report', () => {
  test('reads the day as silly facts, leaving out empty ones', () => {
    const today = counted({ words: 2_341, continues: 14, toolCalls: 96, edits: 12, commits: 3, pushes: 1, longestTurnMs: 23 * MINUTE })
    expect(reportLines(today, 3, 42)).toEqual([
      'You typed 2,341 words to Claude, about a short story.',
      'You said "continue" 14 times.',
      'Claude ran 96 tools and edited 12 files.',
      '3 commits, 1 push, 0 PRs merged.',
      'Longest turn: 23m, long enough to boil 2 eggs.',
      'Pet: Lv3, 42 XP.',
    ])
  })
})

describe('input box', () => {
  test('shows the pet in the empty box at session start', async ($, on) => {
    const { suggested } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    expect(suggested).toContain('ᓚᘏᗢ resting Lv1')
  })

  test('celebrates a push once the turn completes and saves it under today', async ($, on) => {
    const { store, suggested } = stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await $.turn.complete({ answer: 'pushed', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(suggested).toContain('ฅ^•ﻌ•^ฅ~ playing Lv1')

    await $.session.end({ reason: 'other', sessionId: 'session-a', resume: { id: 'session-a' } })
    expect(store.get('day:2026-10-09')).toMatchObject({ 'session-a': { pushes: 1, toolCalls: 1 } })
  })

  test('sends an accepted suggestion without the pet and drops the bare pet', async ($, on) => {
    stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    const accepted = await $.prompt.submit({ text: 'ᓚᘏᗢ resting Lv1  run the tests', wait: false, origin: { kind: 'composer' } })
    expect(accepted.text).toBe('run the tests')
    const bare = await $.prompt.submit({ text: '/ᐠ｡ꞈ｡ᐟ\\ eager Lv1', wait: false, origin: { kind: 'composer' } })
    expect(bare.drop).toMatch(/just your pet/)
  })

  test('/pet-stats reports what the session counted', async ($, on) => {
    stubEngine(on)
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    await $.prompt.submit({ text: 'continue please', wait: false, origin: { kind: 'composer' } })

    const ran = await $.command.run({ command: 'pet-stats', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(ran.text).toMatch(/Today's silly stats/)
    expect(ran.text).toMatch(/You typed 2 words/)
    expect(ran.text).toMatch(/"continue" once and "please" once/)
  })

  test('still shows the cat when its command name is refused', async ($, on) => {
    const { suggested } = stubEngine(on, NOON, { refuseCommands: true })
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    expect(suggested).toContain('ᓚᘏᗢ resting Lv1')
  })

  test('pops the daily report up after the report hour', async ($, on) => {
    const { toasts } = stubEngine(on, at(19))
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    expect(toasts.some(text => text.includes("Today's silly stats"))).toBe(true)
  })

  test('keeps quiet before the report hour', async ($, on) => {
    const { toasts } = stubEngine(on, at(17))
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    expect(toasts).toEqual([])
  })

  test('a report hour of -1 turns the pop-up off', { options: { reportHour: -1 } }, async ($, on) => {
    const { toasts } = stubEngine(on, at(23))
    await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
    expect(toasts).toEqual([])
  })
})
