export type Settings = { isEnabled: boolean; count: number }

export type Line = { role: 'user' | 'assistant'; text: string }

export const DEFAULT_SETTINGS: Settings = { isEnabled: true, count: 3 }

const MAX_COUNT = 3
const ASSISTANT_CHARS = 1_500
const USER_CHARS = 400
const STEP_CHARS = 60

export const settingsOf = (options: Record<string, unknown>): Settings => ({
  isEnabled: options.nextSteps !== false,
  count: Math.min(MAX_COUNT, Math.max(1, Math.floor(Number(options.stepCount ?? DEFAULT_SETTINGS.count)))),
})

const clipped = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}...` : text)

const lastOf = (lines: readonly Line[], role: Line['role']): string | undefined =>
  [...lines].reverse().find(line => line.role === role && line.text.trim() !== '')?.text.trim()

export const stepsPrompt = (lines: readonly Line[], count: number): string | undefined => {
  const answer = lastOf(lines, 'assistant')
  if (answer === undefined) return undefined
  const request = lastOf(lines, 'user') ?? ''
  return [
    `Suggest up to ${count} short follow-up prompts the user could send next in this coding session.`,
    `Each is at most 8 words, imperative, specific to what was just done. One per line, no numbering, no quotes, no commentary.`,
    `If nothing useful follows, reply with the single word NONE.`,
    '',
    `User asked:\n${clipped(request, USER_CHARS)}`,
    '',
    `Assistant answered:\n${clipped(answer, ASSISTANT_CHARS)}`,
  ].join('\n')
}

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s*/
const WRAPPING_QUOTES = /^["'`]+|["'`]+$/g

const cleaned = (line: string): string => line.replace(LIST_MARKER, '').replace(WRAPPING_QUOTES, '').trim()

export const parseSteps = (reply: string, count: number): string[] => {
  if (/^\s*none\b/i.test(reply)) return []
  const unique = new Set(reply.split('\n').map(cleaned).filter(line => line !== '' && line.length <= STEP_CHARS))
  return [...unique].slice(0, count)
}

export const withoutStep = (steps: readonly string[], step: string): string[] => steps.filter(known => known !== step)
