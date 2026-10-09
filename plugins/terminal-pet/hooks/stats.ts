import type { Counters } from '../types'

export type ToolKind = 'commit' | 'push' | 'merge' | 'edit' | 'other'
export type ToolOutcome = 'ok' | 'failed' | 'denied'

const CONTINUE = /^\s*continue\b/i
const PLEASE = /\bplease\b/gi
const WORD = /\S+/g
const GIT_COMMIT = /\bgit\s+commit\b/
const GIT_PUSH = /\bgit\s+push\b/
const PR_MERGE = /\bgh\s+pr\s+merge\b/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const emptyCounters = (): Counters => ({
  prompts: 0,
  words: 0,
  continues: 0,
  pleases: 0,
  toolCalls: 0,
  edits: 0,
  commits: 0,
  pushes: 0,
  merged: 0,
  denials: 0,
  longestTurnMs: 0,
})

export const isEmpty = (counters: Counters): boolean => counters.prompts === 0 && counters.toolCalls === 0

const matchCount = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

export const countPrompt = (counters: Counters, text: string): Counters => ({
  ...counters,
  prompts: counters.prompts + 1,
  words: counters.words + matchCount(text, WORD),
  continues: counters.continues + (CONTINUE.test(text) ? 1 : 0),
  pleases: counters.pleases + matchCount(text, PLEASE),
})

export const toolKind = (call: { tool: string; command?: unknown }): ToolKind => {
  if (EDIT_TOOLS.has(call.tool)) return 'edit'
  if (call.tool !== 'Bash' || typeof call.command !== 'string') return 'other'
  if (PR_MERGE.test(call.command)) return 'merge'
  if (GIT_PUSH.test(call.command)) return 'push'
  if (GIT_COMMIT.test(call.command)) return 'commit'
  return 'other'
}

const SUCCESS_FIELD: Record<Exclude<ToolKind, 'other'>, keyof Counters> = {
  commit: 'commits',
  push: 'pushes',
  edit: 'edits',
  merge: 'merged',
}

export const countTool = (counters: Counters, kind: ToolKind, outcome: ToolOutcome): Counters => {
  const counted = { ...counters, toolCalls: counters.toolCalls + 1 }
  if (outcome === 'denied') return { ...counted, denials: counted.denials + 1 }
  if (outcome === 'failed' || kind === 'other') return counted
  const field = SUCCESS_FIELD[kind]
  return { ...counted, [field]: counted[field] + 1 }
}

export const countTurn = (counters: Counters, durationMs: number): Counters => ({
  ...counters,
  longestTurnMs: Math.max(counters.longestTurnMs, durationMs),
})

export const addCounters = (a: Counters, b: Counters): Counters => ({
  prompts: a.prompts + b.prompts,
  words: a.words + b.words,
  continues: a.continues + b.continues,
  pleases: a.pleases + b.pleases,
  toolCalls: a.toolCalls + b.toolCalls,
  edits: a.edits + b.edits,
  commits: a.commits + b.commits,
  pushes: a.pushes + b.pushes,
  merged: a.merged + b.merged,
  denials: a.denials + b.denials,
  longestTurnMs: Math.max(a.longestTurnMs, b.longestTurnMs),
})

export const sumCounters = (all: readonly Counters[]): Counters => all.reduce(addCounters, emptyCounters())

export const xpOf = (counters: Counters): number => counters.commits + 2 * counters.pushes + 5 * counters.merged
