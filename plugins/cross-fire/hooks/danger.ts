import { expand, type Variables, variablesBefore } from './variables'

export type Danger = { label: string; reach: string }

type Rule = { label: string; pattern: RegExp; reach: (match: RegExpMatchArray) => string }

const DISPOSABLE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.turbo',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
])

const TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/tmp', '/var/folders', '/private/var/folders', '$TMPDIR', '${TMPDIR}']

const RM_RECURSIVE = /\brm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+((?:-[a-zA-Z-]+\s+)*)([^;&|\n]+)/g

const unquoted = (target: string): string => target.replace(/^(['"])(.*)\1$/, '$2')

const targetsOf = (argumentText: string, variables: Variables): string[] =>
  argumentText
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(target => (target.startsWith("'") ? unquoted(target) : expand(unquoted(target), variables)))

const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? path

const climbsOut = (path: string): boolean => path.split('/').includes('..')

const isInsideTempRoot = (target: string): boolean =>
  !climbsOut(target) && TEMP_ROOTS.some(root => target.startsWith(`${root}/`) && target.length > root.length + 1)

const isDisposable = (target: string): boolean => DISPOSABLE_DIRS.has(baseName(target)) || isInsideTempRoot(target)

const describeTargets = (targets: readonly string[]): string => {
  const shown = targets.slice(0, 3).join(', ')
  return targets.length > 3 ? `${shown} and ${targets.length - 3} more` : shown
}

const rules: readonly Rule[] = [
  {
    label: 'force push',
    pattern: /\bgit\s+push\b[^;&|\n]*(?:--force(?!-with-lease)\b|\s-f\b)/,
    reach: () => 'rewrites the remote branch history for everyone who pulled it',
  },
  {
    label: 'hard reset',
    pattern: /\bgit\s+reset\b[^;&|\n]*--hard\b/,
    reach: () => 'discards every uncommitted change in the working tree and index',
  },
  {
    label: 'git clean',
    pattern: /\bgit\s+clean\b[^;&|\n]*\s-[a-zA-Z]*f/,
    reach: () => 'deletes untracked files that git cannot bring back',
  },
  {
    label: 'branch delete',
    pattern: /\bgit\s+branch\b[^;&|\n]*\s-D\b/,
    reach: () => 'deletes a branch even if its commits were never merged',
  },
  {
    label: 'discard checkout',
    pattern: /\bgit\s+(?:checkout|restore)\b[^;&|\n]*\s(?:--\s+)?\.(?:\s|$)/,
    reach: () => 'throws away all unstaged edits in the current directory',
  },
  {
    label: 'SQL drop',
    pattern: /\b(?:drop\s+(?:table|database|schema)|truncate\s+table)\b/i,
    reach: () => 'removes tables or their rows permanently',
  },
  {
    label: 'raw disk write',
    pattern: /\b(?:dd\s+[^;&|\n]*\bof=|mkfs(?:\.\w+)?\s)/,
    reach: () => 'overwrites a device or filesystem',
  },
  {
    label: 'recursive permission change',
    pattern: /\b(?:chmod|chown)\s+(?:-[a-zA-Z]*R[a-zA-Z]*)\s/,
    reach: () => 'changes access for every file below the target',
  },
]

const targetsOfRemoval = (command: string, match: RegExpMatchArray): string[] =>
  targetsOf(match[2] ?? '', variablesBefore(command, match.index ?? 0))

const isDisposableRemoval = (targets: readonly string[]): boolean => targets.length > 0 && targets.every(isDisposable)

const recursiveRemoval = (command: string): Danger | undefined => {
  const risky = [...command.matchAll(RM_RECURSIVE)]
    .map(match => targetsOfRemoval(command, match))
    .filter(targets => !isDisposableRemoval(targets))
  if (risky.length === 0) return undefined
  return { label: 'recursive delete', reach: `deletes ${describeTargets(risky.flat())} and everything inside, with no trash to restore from` }
}

export const assess = (command: string): Danger | undefined => {
  const removal = recursiveRemoval(command)
  if (removal) return removal
  const rule = rules.find(candidate => candidate.pattern.test(command))
  const match = rule?.pattern && command.match(rule.pattern)
  return rule && match ? { label: rule.label, reach: rule.reach(match) } : undefined
}

export const holdReason = ({ label, reach }: Danger): string => `cross-fire held a ${label}: it ${reach}.`
