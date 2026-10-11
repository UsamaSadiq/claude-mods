import type { Page } from '../types'

export const MAX_CHARS = 90_000
export const MAX_RECENT = 5

const MARKDOWN_FILE = /\.(?:md|markdown|mdx)$/i
const EDIT_TOOLS = new Set(['Edit', 'Write'])

export const isMarkdownFile = (path: string): boolean => MARKDOWN_FILE.test(path)

export const markdownPathOf = (call: { tool: string; file_path?: unknown }): string | undefined =>
  EDIT_TOOLS.has(call.tool) && typeof call.file_path === 'string' && isMarkdownFile(call.file_path) ? call.file_path : undefined

export const resolvePath = (cwd: string, path: string): string => {
  const trimmed = path.trim()
  if (trimmed.startsWith('/')) return trimmed
  return `${cwd.replace(/\/+$/, '')}/${trimmed.replace(/^\.\//, '')}`
}

export const relativeTo = (cwd: string, path: string): string => {
  const root = `${cwd.replace(/\/+$/, '')}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

export const pageOf = (path: string, text: string): Page =>
  text.length > MAX_CHARS
    ? { path, text: `${text.slice(0, MAX_CHARS)}\n\n*Showing the first ${MAX_CHARS.toLocaleString('en-US')} characters.*`, isTruncated: true }
    : { path, text, isTruncated: false }

export const withRecent = (recent: readonly string[], path: string): string[] =>
  [path, ...recent.filter(known => known !== path)].slice(0, MAX_RECENT)

export const fileName = (path: string): string => path.split('/').pop() ?? path
