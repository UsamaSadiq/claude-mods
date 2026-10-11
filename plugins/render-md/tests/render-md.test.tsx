import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MAX_CHARS, MAX_RECENT, isMarkdownFile, markdownPathOf, pageOf, relativeTo, resolvePath, withRecent } from '../hooks/markdown'

describe('markdown helpers', () => {
  test('recognises Markdown files by extension', () => {
    expect(['a.md', 'B.MARKDOWN', 'c.mdx'].every(isMarkdownFile)).toBe(true)
    expect(['a.mdc', 'notes.txt', 'md'].some(isMarkdownFile)).toBe(false)
  })

  test('only successful-shaped Edit and Write calls on Markdown count', () => {
    expect(markdownPathOf({ tool: 'Edit', file_path: '/p/README.md' })).toBe('/p/README.md')
    expect(markdownPathOf({ tool: 'Write', file_path: '/p/a.md' })).toBe('/p/a.md')
    expect(markdownPathOf({ tool: 'Read', file_path: '/p/a.md' })).toBeUndefined()
    expect(markdownPathOf({ tool: 'Edit', file_path: '/p/a.ts' })).toBeUndefined()
  })

  test('resolves paths against the session directory', () => {
    expect(resolvePath('/p/', './docs/a.md')).toBe('/p/docs/a.md')
    expect(resolvePath('/p', '/abs/a.md')).toBe('/abs/a.md')
    expect(relativeTo('/p', '/p/docs/a.md')).toBe('docs/a.md')
    expect(relativeTo('/p', '/other/a.md')).toBe('/other/a.md')
  })

  test('caps long documents and says so', () => {
    expect(pageOf('/a.md', 'short')).toEqual({ path: '/a.md', text: 'short', isTruncated: false })
    const long = pageOf('/a.md', 'x'.repeat(MAX_CHARS + 10))
    expect(long.isTruncated).toBe(true)
    expect(long.text).toMatch(/Showing the first 90,000 characters/)
  })

  test('keeps the most recent files first without repeats', () => {
    const files = Array.from({ length: MAX_RECENT + 2 }, (_, i) => `/f${i}.md`)
    const recent = files.reduce<string[]>((known, path) => withRecent(known, path), [])
    expect(recent).toHaveLength(MAX_RECENT)
    const middle = recent[2] ?? ''
    expect(withRecent(recent, middle)[0]).toBe(middle)
    expect(withRecent(recent, middle)).toHaveLength(MAX_RECENT)
  })
})

const stubEngine = (on: On, files: Record<string, string>) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  return { opened, clock }
}

const BOOT = { cwd: '/p', surface: 'terminal', isInteractive: true } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

describe('hook', () => {
  test('/render-md opens a file and reports it', async ($, on) => {
    const { opened } = stubEngine(on, { '/p/docs/a.md': '# Hello' })
    await $.session.start(BOOT)
    const ran = await $.command.run({ command: 'render-md', args: 'docs/a.md', ...RUN })
    expect(ran.text).toBe('render-md: showing docs/a.md.')
    expect(opened).toEqual(['render-md'])
  })

  test('/render-md refuses missing and non-Markdown files', async ($, on) => {
    stubEngine(on, {})
    await $.session.start(BOOT)
    expect((await $.command.run({ command: 'render-md', args: 'nope.md', ...RUN })).text).toMatch(/does not exist/)
    expect((await $.command.run({ command: 'render-md', args: 'a.ts', ...RUN })).text).toMatch(/not a Markdown file/)
    expect((await $.command.run({ command: 'render-md', args: '', ...RUN })).text).toMatch(/no Markdown file yet/)
  })

  test('opens the pane after Claude edits a Markdown file', async ($, on) => {
    const { opened, clock } = stubEngine(on, { '/p/README.md': '# Hi' })
    await $.session.start(BOOT)
    await $.tool.call({ tool: 'Edit', file_path: '/p/README.md', old_string: 'a', new_string: 'b' })
    await clock.settle()
    expect(opened).toEqual(['render-md'])
  })

  test('autoOpen off keeps the pane shut', { options: { autoOpen: false } }, async ($, on) => {
    const { opened, clock } = stubEngine(on, { '/p/README.md': '# Hi' })
    await $.session.start(BOOT)
    await $.tool.call({ tool: 'Write', file_path: '/p/README.md', content: '# Hi' })
    await clock.settle()
    expect(opened).toEqual([])
  })

  test('draws the rendered document on every surface that has a Markdown element', async ($, on) => {
    stubEngine(on, { '/p/a.md': '# Title\n\nbody' })
    await $.session.start(BOOT)
    await $.command.run({ command: 'render-md', args: 'a.md', ...RUN })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'render-md',
        surface,
        component: 'Pane',
        requestId: 'render-md',
        props: { title: 'Markdown', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 20 }, view: {} } as never,
      })
      expect(await ui.find({ type: 'Markdown' })).toBeDefined()
      await ui.unmount()
    }
  })
})
