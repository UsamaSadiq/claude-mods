import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Page } from '../types'
import { markdownPathOf, pageOf, relativeTo, resolvePath, withRecent, fileName, isMarkdownFile } from './markdown'

const PANE = 'render-md'
const NO_PAGE: Page = { path: '', text: '', isTruncated: false }

const page = atom({ plugin: 'render-md', key: 'page' } as const, NO_PAGE)
const recent = atom({ plugin: 'render-md', key: 'recent' } as const, [] as string[])
const cwd = atom({ plugin: 'render-md', key: 'cwd' } as const, '')

const skipFailedRun = () => undefined

const inBackground = (run: Promise<unknown>): void => void run.catch(skipFailedRun)

const showFile = async ($: EngineInterface, path: string) => {
  const text = await $.fs.read(path)
  await Promise.all([update($, page, () => pageOf(path, text)), update($, recent, known => withRecent(known, path))])
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Markdown' })

const showAndOpen = async ($: EngineInterface, path: string) => {
  await showFile($, path)
  await openPane($)
}

const renderCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const root = await read($, cwd)
  const requested = args.trim()
  if (requested === '') {
    const current = await read($, page)
    if (current.path === '') return 'render-md: no Markdown file yet. Use /render-md <file>.'
    await openPane($)
    return `render-md: showing ${relativeTo(root, current.path)}.`
  }
  if (!isMarkdownFile(requested)) return `render-md: ${requested} is not a Markdown file.`
  const path = resolvePath(root, requested)
  if (!(await $.fs.exists(path))) return `render-md: ${requested} does not exist.`
  await showAndOpen($, path)
  return `render-md: showing ${relativeTo(root, path)}.`
}

export const register: Register = (on, options) => {
  const autoOpen = options.autoOpen !== false

  on('session.start', async ($, e, next) => {
    await update($, cwd, () => e.cwd)
    await $.command
      .register({ name: 'render-md', description: 'Render a Markdown file in a side pane' })
      .catch(skipFailedRun)
    return next(e)
  })

  on('command.run', { command: 'render-md' }, async ($, e) => ({ text: await renderCommand($, e.args) }))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const path = markdownPathOf(e)
    const succeeded = !('deny' in result && result.deny !== undefined) && !result.isError
    if (path && succeeded) inBackground(autoOpen ? showAndOpen($, path) : showFile($, path))
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const [current, known, root] = await Promise.all([read($, page), read($, recent), read($, cwd)])
    if (current.path === '') return <Text dimColor>Nothing rendered yet. Edit a Markdown file or use /render-md &lt;file&gt;.</Text>
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          {known.map(path => (
            <Button key={`file:${path}`} plain onPress={() => inBackground(showFile($, path))}>
              <Text dimColor={path !== current.path} bold={path === current.path}>
                {fileName(path)}{'  '}
              </Text>
            </Button>
          ))}
        </Box>
        <Text dimColor>{relativeTo(root, current.path)}</Text>
        <Markdown text={current.text} />
      </Box>
    )
  })
}
