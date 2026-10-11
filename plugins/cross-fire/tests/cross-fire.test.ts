import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { assess, holdReason } from '../hooks/danger'

const labelOf = (command: string): string | undefined => assess(command)?.label

describe('danger', () => {
  test('holds recursive deletes and names the targets', () => {
    expect(labelOf('rm -rf ./src /var/data')).toBe('recursive delete')
    expect(assess('rm -rf ./src /var/data')?.reach).toMatch(/\.\/src, \/var\/data/)
    expect(labelOf('sudo rm -fr /')).toBe('recursive delete')
  })

  test('lets disposable build directories go', () => {
    expect(labelOf('rm -rf node_modules')).toBeUndefined()
    expect(labelOf('rm -rf dist build/ .next')).toBeUndefined()
    expect(labelOf('rm -rf node_modules src')).toBe('recursive delete')
  })

  test('holds force pushes but not leased ones', () => {
    expect(labelOf('git push --force origin main')).toBe('force push')
    expect(labelOf('git push -f')).toBe('force push')
    expect(labelOf('git push --force-with-lease')).toBeUndefined()
    expect(labelOf('git push origin main')).toBeUndefined()
  })

  test('holds history and working tree losses', () => {
    expect(labelOf('git reset --hard HEAD~3')).toBe('hard reset')
    expect(labelOf('git clean -fdx')).toBe('git clean')
    expect(labelOf('git branch -D old')).toBe('branch delete')
    expect(labelOf('git checkout -- .')).toBe('discard checkout')
    expect(labelOf('git status')).toBeUndefined()
  })

  test('holds destructive SQL and migrations', () => {
    expect(labelOf('psql -c "DROP TABLE users"')).toBe('SQL drop')
    expect(labelOf('python manage.py migrate')).toBe('migration')
    expect(labelOf('alembic downgrade -1')).toBe('migration')
    expect(labelOf('ls -la')).toBeUndefined()
  })

  test('explains the hold in one sentence', () => {
    expect(holdReason({ label: 'hard reset', reach: 'discards changes' })).toBe('cross-fire held a hard reset: it discards changes.')
  })
})

const asking = (on: On) => on('tool.check', () => ({ decision: 'allow' as const }))

describe('hook', () => {
  test('puts a destructive command to the person', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force' } })
    expect(verdict.decision).toBe('ask')
    expect(verdict.reason).toMatch(/force push/)
  })

  test('leaves ordinary commands to the usual rules', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
    expect(verdict.decision).toBe('allow')
  })

  test('ignores other tools', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Read', input: { file_path: '/etc/hosts' } })
    expect(verdict.decision).toBe('allow')
  })
})
