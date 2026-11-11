import { describe, expect, test } from 'claude-code/testing'
import type { ModelCompleteResult, On } from 'claude-code'

import {
  hasRules,
  isGuardedCommand,
  judgePrompt,
  parseVerdict,
  referencedFile,
  referencedFilePaths,
  resolvePath,
  ruleLocations,
  ruleSource,
} from '../hooks/rules'

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
  const evidence = 'git commit -m "Updated things"\n## Summary\n- x'

  test('reads a block whose quote appears in the command or files', () => {
    expect(parseVerdict('BLOCK: "Updated things" subject is not a Conventional Commit; use fix: ...', evidence)).toBe(
      '"Updated things": subject is not a Conventional Commit; use fix: ...',
    )
    expect(parseVerdict('block:  "## Summary": keep only Description and Testing\nextra', evidence)).toBe(
      '"## Summary": keep only Description and Testing',
    )
  })

  test('treats OK and anything unreadable as a pass', () => {
    expect(parseVerdict('OK', evidence)).toBeUndefined()
    expect(parseVerdict('', evidence)).toBeUndefined()
    expect(parseVerdict('I think this is fine', evidence)).toBeUndefined()
  })

  test('ignores a block without a quote', () => {
    expect(parseVerdict('BLOCK: subject is not a Conventional Commit', evidence)).toBeUndefined()
  })

  test('ignores a block whose quote is not in the command or files', () => {
    expect(parseVerdict('BLOCK: "fix: x — y" contains an em-dash', evidence)).toBeUndefined()
  })

  test('ignores a block that wavers mid-sentence', () => {
    expect(parseVerdict('BLOCK: "## Summary" style is met. Wait, nothing violates, so this is wrong.', evidence)).toBeUndefined()
  })

  test('ignores a block that argues itself back to a pass', () => {
    expect(parseVerdict('BLOCK: "Updated things" so recheck: no concrete violation exists.', evidence)).toBeUndefined()
    expect(parseVerdict('BLOCK: "## Summary" this follows every rule, so it should pass.', evidence)).toBeUndefined()
  })
})

describe('referenced files', () => {
  test('finds body and message files in any spelling', () => {
    expect(referencedFilePaths('gh pr create --title t --body-file /tmp/body.md')).toEqual(['/tmp/body.md'])
    expect(referencedFilePaths('gh pr create --body-file="/tmp/a b.md"')).toEqual(['/tmp/a b.md'])
    expect(referencedFilePaths("gh pr edit 4 -F 'notes.md'")).toEqual(['notes.md'])
    expect(referencedFilePaths('git commit -F msg.txt && git push')).toEqual(['msg.txt'])
    expect(referencedFilePaths('git commit --file=msg.txt')).toEqual(['msg.txt'])
  })

  test('skips stdin and commands without a file', () => {
    expect(referencedFilePaths('git commit -F -')).toEqual([])
    expect(referencedFilePaths('gh pr create --body "x"')).toEqual([])
  })

  test('resolves relative paths against the session root', () => {
    expect(resolvePath('body.md', '/work/app')).toBe('/work/app/body.md')
    expect(resolvePath('/tmp/body.md', '/work/app')).toBe('/tmp/body.md')
  })

  test('puts file contents in the prompt, and marks unreadable ones', () => {
    const prompt = judgePrompt([ruleSource('r', 'no em-dashes')], 'gh pr create --body-file b.md', [
      referencedFile('b.md', '## Description\n- x'),
      referencedFile('gone.md', undefined),
    ])
    expect(prompt).toContain('<file path="b.md">\n## Description\n- x\n</file>')
    expect(prompt).toContain('<file path="gone.md" unreadable="true"></file>')
  })
})

const COMMIT_WITH_BAD_SUBJECT = ['git', 'commit', '-m', '"Updated things"'].join(' ')

const passThrough = (on: On) => on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: NO_USAGE })

const NO_REPLY: ModelCompleteResult = { isAnswered: false, reason: 'empty-reply', usage: NO_USAGE }

const isConfirmCall = (prompt: string): boolean => prompt.includes('Answer with one word: YES or NO')

const withRules = (
  on: On,
  rules: Record<string, string>,
  reply: ModelCompleteResult,
  asked: string[] = [],
  confirm: ModelCompleteResult = answered('YES'),
) => {
  on('env.get', () => ({ value: '/home/u' }))
  on('session.root', () => ({ value: '/work/app' }))
  on('fs.exists', (_$, e) => ({ value: e.path in rules }))
  on('fs.read', (_$, e) => ({ value: rules[e.path] ?? '' }))
  on('model.complete', (_$, e) => {
    asked.push(e.model)
    return { value: isConfirmCall(e.prompt) ? confirm : reply }
  })
  passThrough(on)
}

describe('hook', () => {
  const rules = { '/home/u/.claude/CLAUDE.md': 'Use Conventional Commits.' }

  test('denies a command the judge blocks, with the reason', async ($, on) => {
    withRules(on, rules, answered('BLOCK: "Updated things" use a Conventional Commit subject.'))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "Updated things"' })
    expect(ran.deny).toBe('security-guard: "Updated things": use a Conventional Commit subject. Fix it and run the command again.')
  })

  test('denies on a quote that only the body file contains', async ($, on) => {
    on('env.get', () => ({ value: '/home/u' }))
    on('session.root', () => ({ value: '/work/app' }))
    const files: Record<string, string> = { ...rules, '/work/app/body.md': '## Summary\n- x' }
    on('fs.exists', (_$, e) => ({ value: e.path in files }))
    on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
    on('model.complete', (_$, e) => ({
      value: isConfirmCall(e.prompt) ? answered('YES') : answered('BLOCK: "## Summary" keep only Description and Testing.'),
    }))
    passThrough(on)
    const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr create --title t --body-file body.md' })
    expect(ran.deny).toBe('security-guard: "## Summary": keep only Description and Testing. Fix it and run the command again.')
  })

  test('runs a command when the confirmation says the quote is fine', async ($, on) => {
    withRules(on, rules, answered('BLOCK: "Updated things" use a Conventional Commit subject.'), [], answered('NO'))
    const ran = await $.tool.call({ tool: 'Bash', command: COMMIT_WITH_BAD_SUBJECT })
    expect(ran.deny).toBeUndefined()
  })

  test('runs a command when the block quotes text that is not there', async ($, on) => {
    withRules(on, rules, answered('BLOCK: "an em—dash" remove the em-dash.'))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' })
    expect(ran.deny).toBeUndefined()
  })

  test('runs a command the judge accepts', async ($, on) => {
    withRules(on, rules, answered('OK'))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' })
    expect(ran.deny).toBeUndefined()
  })

  test('asks sonnet unless the model option says otherwise', async ($, on) => {
    const asked: string[] = []
    withRules(on, rules, answered('OK'), asked)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "fix: x"' })
    expect(asked).toEqual(['sonnet'])
  })

  test('skips the judge when no rules exist', async ($, on) => {
    withRules(on, {}, answered('BLOCK: should never be asked'))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "anything"' })
    expect(ran.deny).toBeUndefined()
  })

  test('does not judge other commands', async ($, on) => {
    withRules(on, rules, answered('BLOCK: should never be asked'))
    const ran = await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(ran.deny).toBeUndefined()
  })

  test('shows the judge the body file contents', async ($, on) => {
    const prompts: string[] = []
    on('env.get', () => ({ value: '/home/u' }))
    on('session.root', () => ({ value: '/work/app' }))
    const files: Record<string, string> = { ...rules, '/work/app/body.md': '## Summary\n- x' }
    on('fs.exists', (_$, e) => ({ value: e.path in files }))
    on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
    on('model.complete', (_$, e) => {
      prompts.push(e.prompt)
      return { value: answered('OK') }
    })
    passThrough(on)
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --title t --body-file body.md' })
    expect(prompts[0]).toContain('<file path="body.md">\n## Summary\n- x\n</file>')
  })

  test('lets the command through when the judge is unavailable', async ($, on) => {
    withRules(on, rules, NO_REPLY)
    const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
    expect(ran.deny).toBeUndefined()
  })
})
