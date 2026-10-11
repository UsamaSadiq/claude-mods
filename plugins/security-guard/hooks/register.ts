import type { EngineInterface, Register } from 'claude-code'

import { hasRules, isGuardedCommand, judgePrompt, parseVerdict, ruleLocations, ruleSource } from './rules'
import type { RuleSource } from './rules'

const JUDGE_MODEL = 'haiku'
const JUDGE_MAX_TOKENS = 120
const JUDGE_TIMEOUT_MS = 20000

const refusal = (violation: string): string => `security-guard: ${violation} Fix it and run the command again.`

const readIfPresent = async ($: EngineInterface, path: string): Promise<string> =>
  (await $.fs.exists(path)) ? $.fs.read(path).catch(() => '') : ''

const loadRules = async ($: EngineInterface): Promise<RuleSource[]> => {
  const home = await $.env.get('HOME')
  const root = await $.session.root()
  return Promise.all(
    ruleLocations(home, root).map(async location => ruleSource(location.label, await readIfPresent($, location.path))),
  )
}

const judgeCommand = async ($: EngineInterface, command: string): Promise<string | undefined> => {
  const sources = await loadRules($)
  if (!hasRules(sources)) return undefined
  const reply = await $.model.complete({
    model: JUDGE_MODEL,
    prompt: judgePrompt(sources, command),
    maxTokens: JUDGE_MAX_TOKENS,
    effort: 'low',
    timeoutMs: JUDGE_TIMEOUT_MS,
  })
  return reply.isAnswered ? parseVerdict(reply.text) : undefined
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isGuardedCommand(e.command)) return next(e)
    const violation = await judgeCommand($, e.command)
    return violation ? { deny: refusal(violation) } : next(e)
  }).catch((_$, e, next) => next(e))
}
