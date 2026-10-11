import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseSteps, settingsOf, stepsPrompt, withoutStep } from '../hooks/steps'

describe('steps', () => {
  test('asks about the latest exchange only', () => {
    const prompt = stepsPrompt(
      [
        { role: 'user', text: 'old question' },
        { role: 'assistant', text: 'old answer' },
        { role: 'user', text: 'add a login page' },
        { role: 'assistant', text: 'Added the login page and its route.' },
      ],
      3,
    )
    expect(prompt).toMatch(/up to 3 short follow-up prompts/)
    expect(prompt).toMatch(/add a login page/)
    expect(prompt).toMatch(/Added the login page/)
    expect(prompt).not.toMatch(/old answer/)
  })

  test('has nothing to ask before the assistant has answered', () => {
    expect(stepsPrompt([{ role: 'user', text: 'hi' }], 3)).toBeUndefined()
  })

  test('cleans a model reply into short unique steps', () => {
    const reply = '1. run the tests\n- "add a unit test"\n\n* run the tests\nthis line is far too long to be a useful short follow-up prompt for anyone\nopen a PR'
    expect(parseSteps(reply, 3)).toEqual(['run the tests', 'add a unit test', 'open a PR'])
    expect(parseSteps(reply, 2)).toEqual(['run the tests', 'add a unit test'])
  })

  test('NONE means no suggestions', () => {
    expect(parseSteps('NONE', 3)).toEqual([])
    expect(parseSteps('none.', 3)).toEqual([])
  })

  test('settings clamp the count and can switch the feature off', () => {
    expect(settingsOf({})).toEqual({ isEnabled: true, count: 3 })
    expect(settingsOf({ stepCount: 9 }).count).toBe(3)
    expect(settingsOf({ stepCount: 0 }).count).toBe(1)
    expect(settingsOf({ nextSteps: false }).isEnabled).toBe(false)
    expect(withoutStep(['a', 'b'], 'a')).toEqual(['b'])
  })
})

const NOON = new Date(2026, 9, 9, 12).getTime()
const BOOT = { cwd: '/x', surface: 'terminal', isInteractive: true } as const
const answered = { answer: 'Added the login page.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as const

const stubEngine = (on: On, reply = 'run the tests\nadd a unit test\nopen a PR') => {
  const clock = mock.clock(on, { now: NOON })
  const filled: string[] = []
  const completions: string[] = []
  const store = new Map<string, unknown>()
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-a' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'add a login page', toolUses: [] },
      { role: 'assistant', text: 'Added the login page.', toolUses: [] },
    ],
  }) as never)
  on('model.complete', (_$, e) => {
    completions.push(String(e.prompt))
    return { value: { isAnswered: true, text: reply, usage: {} } } as never
  })
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  return { filled, completions, clock }
}

const BAND = {
  plugin: 'terminal-pet',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { bodyRows: 5 } } as never,
} as const

describe('next steps', () => {
  test('writes suggestions after an answer and shows them above the box', async ($, on) => {
    const { completions, clock } = stubEngine(on)
    await $.session.start(BOOT)
    await $.turn.complete(answered)
    await clock.settle()
    expect(completions).toHaveLength(1)

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await band.find({ key: 'step-0' })).toBeDefined()
      expect(await band.find({ key: 'step-2' })).toBeDefined()
      await band.unmount()
    }
  })

  test('pressing one fills the box and clears the rest', async ($, on) => {
    const { filled, clock } = stubEngine(on)
    await $.session.start(BOOT)
    await $.turn.complete(answered)
    await clock.settle()
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await band.press({ key: 'step-1' })
    await clock.settle()
    expect(filled).toEqual(['add a unit test'])
    await band.unmount()
  })

  test('stays quiet after an interrupted turn', async ($, on) => {
    const { completions, clock } = stubEngine(on)
    await $.session.start(BOOT)
    await $.turn.complete({ ...answered, reason: 'aborted', isAborted: true })
    await clock.settle()
    expect(completions).toEqual([])
  })

  test('can be switched off', { options: { nextSteps: false } }, async ($, on) => {
    const { completions, clock } = stubEngine(on)
    await $.session.start(BOOT)
    await $.turn.complete(answered)
    await clock.settle()
    expect(completions).toEqual([])
  })

  test('a new prompt drops the old suggestions', async ($, on) => {
    const { clock } = stubEngine(on)
    await $.session.start(BOOT)
    await $.turn.complete(answered)
    await clock.settle()
    await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await band.find({ key: 'step-0' })).toBeUndefined()
    await band.unmount()
  })
})
