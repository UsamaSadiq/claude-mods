import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import {
  evidenceOf,
  hasRules,
  isGuardedCommand,
  judgePrompt,
  parseVerdict,
  referencedFile,
  referencedFilePaths,
  resolvePath,
  ruleLocations,
  ruleSource,
} from './rules'
import type { ReferencedFile, RuleSource } from './rules'

const DEFAULT_JUDGE_MODEL = 'sonnet'
const JUDGE_MAX_TOKENS = 120
const JUDGE_TIMEOUT_MS = 20000

const judgeModelOf = (options: PluginOptions): string => {
  const model = options.model
  return typeof model === 'string' && model.trim() !== '' ? model.trim() : DEFAULT_JUDGE_MODEL
}

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

const readReferencedFile = async ($: EngineInterface, path: string, root: string): Promise<ReferencedFile> => {
  const resolved = resolvePath(path, root)
  const text = (await $.fs.exists(resolved)) ? await $.fs.read(resolved).catch(() => undefined) : undefined
  return referencedFile(path, text)
}

const loadReferencedFiles = async ($: EngineInterface, command: string): Promise<ReferencedFile[]> => {
  const paths = referencedFilePaths(command)
  if (paths.length === 0) return []
  const root = await $.session.root()
  return Promise.all(paths.map(path => readReferencedFile($, path, root)))
}

const judgeCommand = async ($: EngineInterface, model: string, command: string): Promise<string | undefined> => {
  const sources = await loadRules($)
  if (!hasRules(sources)) return undefined
  const files = await loadReferencedFiles($, command)
  const reply = await $.model.complete({
    model,
    prompt: judgePrompt(sources, command, files),
    maxTokens: JUDGE_MAX_TOKENS,
    effort: 'low',
    timeoutMs: JUDGE_TIMEOUT_MS,
  })
  return reply.isAnswered ? parseVerdict(reply.text, evidenceOf(command, files)) : undefined
}

export const register: Register = (on, options) => {
  const judgeModel = judgeModelOf(options)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isGuardedCommand(e.command)) return next(e)
    const violation = await judgeCommand($, judgeModel, e.command)
    return violation ? { deny: refusal(violation) } : next(e)
  }).catch((_$, e, next) => next(e))
}
