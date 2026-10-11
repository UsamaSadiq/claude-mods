import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hasRules, isGuardedCommand, judgePrompt, parseVerdict, ruleLocations, ruleSource } from '../hooks/rules'

describe('guarded commands', () => {
  test('matches commits and pull request writes', () => {
    expect(isGuardedCommand('git commit -m "x"')).toBe(true)
    expect(isGuardedCommand('git -C /repo commit -am "x"')).toBe(true)
    expect(isGuardedCommand('gh pr create --title t')).toBe(true)
    expect(isGuardedCommand('gh pr edit 4 --body b')).toBe(true)
  })

  test('ignores everything else', () => {
    expect(isGuardedCommand('git log --oneline')).toBe(false)
    expect(isGuardedCommand('gh pr view 4')).toBe(false)
    expect(isGuardedCommand('echo commit')).toBe(false)
  })
})

describe('rule locations', () => {
  test('lists user then project files', () => {
    expect(ruleLocations('/home/u', '/work/app').map(location => location.path)).toEqual([
      '/home/u/.claude/CLAUDE.md',
      '/work/app/CLAUDE.md',
      '/work/app/.claude/CLAUDE.md',
      '/work/app/CLAUDE.local.md',
    ])
  })

  test('skips the personal file without a home directory', () => {
    expect(ruleLocations(undefined, '/work/app')).toHaveLength(3)
  })
})

describe('rule sources', () => {
  test('trims and caps the text', () => {
    expect(ruleSource('x', '  hello \n').text).toBe('hello')
    expect(ruleSource('x', 'a'.repeat(30000)).text).toHaveLength(20000)
  })

  test('reports whether any file held rules', () => {
    expect(hasRules([ruleSource('a', ''), ruleSource('b', '  ')])).toBe(false)
    expect(hasRules([ruleSource('a', ''), ruleSource('b', 'use conventional commits')])).toBe(true)
  })
})

describe('judge prompt', () => {
  test('carries every non-empty rule source and the command', () => {
    const prompt = judgePrompt([ruleSource('your personal rules', 'no emojis'), ruleSource('the project rules', '')], 'git commit -m "x"')
    expect(prompt).toContain('<rules from="your personal rules">\nno emojis\n</rules>')
    expect(prompt).not.toContain('the project rules')
    expect(prompt).toContain('<command>\ngit commit -m "x"\n</command>')
  })
})

describe('verdict', () => {
  test('reads a block reason', () => {
    expect(parseVerdict('BLOCK: subject is not a Conventional Commit; use feat: ...')).toBe('subject is not a Conventional Commit; use feat: ...')
    expect(parseVerdict('block:   lowercase works too\nextra')).toBe('lowercase works too')
  })

  test('treats OK and anything unreadable as a pass', () => {
    expect(parseVerdict('OK')).toBeUndefined()
    expect(parseVerdict('')).toBeUndefined()
    expect(parseVerdict('I think this is fine')).toBeUndefined()
  })
})

const passThrough = (on: On) => on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))

const withRules = (on: On, rules: Record<string, string>, reply: { isAnswered: boolean; text?: string }) => {
  on('env.get', () => ({ value: '/home/u' }))
  on('session.root', () => ({ value: '/work/app' }))
  on('fs.exists', (_$, e) => ({ value: e.path in rules }))
  on('fs.read', (_$, e) => ({ value: rules[e.path] ?? '' }))
  on('model.complete', () => ({ value: reply }))
  passThrough(on)
}

describe('hook', () => {
  const rules = { '/home/u/.claude/CLAUDE.md': 'Use Conventional Commits.' }

  test('denies a command the judge blocks, with the reason', async ($, on) => {
    withRules(on, rules, { isAnswered: true, text: 'BLOCK: use a Conventional Commit subject.' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "Updated things"' })
    expect(ran.deny).toBe('security-guard: use a Conventional Commit subject. Fix it and run the command again.')
  })

  test('runs a command the judge accepts', async ($, on) => {
    withRules(on, rules, { isAnswered: true, text: 'OK' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' })
    expect(ran.deny).toBeUndefined()
  })

  test('skips the judge when no rules exist', async ($, on) => {
    withRules(on, {}, { isAnswered: true, text: 'BLOCK: should never be asked' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "anything"' })
    expect(ran.deny).toBeUndefined()
  })

  test('does not judge other commands', async ($, on) => {
    withRules(on, rules, { isAnswered: true, text: 'BLOCK: should never be asked' })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(ran.deny).toBeUndefined()
  })

  test('lets the command through when the judge is unavailable', async ($, on) => {
    withRules(on, rules, { isAnswered: false })
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
    expect(ran.deny).toBeUndefined()
  })
})
