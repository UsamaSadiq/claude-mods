import type { Register } from 'claude-code'

import { assess, holdReason } from './danger'

const commandOf = (input: unknown): string => {
  const command = (input as { command?: unknown } | null)?.command
  return typeof command === 'string' ? command : ''
}

export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const danger = assess(commandOf(e.input))
    if (!danger) return next(e)
    return { decision: 'ask', reason: holdReason(danger) }
  }).catch(($, e, next) => (next.called ? next(e) : { decision: 'ask', reason: 'cross-fire could not judge this command.' }))
}
