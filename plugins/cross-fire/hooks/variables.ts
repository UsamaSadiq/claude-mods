export type Variables = ReadonlyMap<string, string>

type Assignment = { name: string; value: string }

type ScanState = {
  single: boolean
  double: boolean
  backtick: boolean
  escaped: boolean
  escapeOutsideSingle: boolean
  substitutionInDouble: boolean
  masked: string
}

const NO_VARIABLES: Variables = new Map()

const QUOTED_MASK = '\u0001'

const NAME = String.raw`[A-Za-z_]\w*`

const VALUE_PART = String.raw`(?:[A-Za-z0-9_./~+-]|\$${NAME}|\$\{${NAME}\})`

const VALUE = String.raw`(?:'[A-Za-z0-9_./~+-]+'|"${VALUE_PART}+"|${VALUE_PART}+)`

const LEADING_ASSIGNMENT = new RegExp(String.raw`^[ \t]*(${NAME})=(${VALUE})[ \t]*(?:;|&&|\n)\s*`)

const UNSAFE_TEXT = new RegExp(
  [
    String.raw`\b(?:eval|source|declare|typeset|local|export|readonly|let|read|mapfile|readarray|getopts|unset|print|alias|exec|builtin|command|enable|trap|noglob|nocorrect|setopt|emulate)\b`,
    String.raw`\bprintf\b(?!\s+['"][^-'"\s])`,
    String.raw`(?:^|[\s;&|({])\.(?=\s)`,
    '#',
    String.raw`\$'`,
    String.raw`\(\s*\)`,
    String.raw`\bfunction\b`,
    String.raw`\bIFS\b`,
    '<<',
  ].join('|'),
)

const UNSAFE_COMMAND_WORDS = new Set([
  'eval',
  'source',
  '.',
  'set',
  'declare',
  'typeset',
  'local',
  'export',
  'readonly',
  'let',
  'read',
  'mapfile',
  'readarray',
  'getopts',
  'unset',
  'print',
  'alias',
  'exec',
  'builtin',
  'command',
  'enable',
  'trap',
  'noglob',
  'nocorrect',
  'setopt',
  'emulate',
  '-',
])

const LEADING_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', 'time'])

const PLAIN_WORD = /^[A-Za-z0-9_./+-]+$/

const SEGMENT_BREAK = /[;&|(){}\n]/

const TRUSTED_NAME = /^[A-Z][A-Z0-9_]*$/

const SHELL_PREFIXES = /^(?:BASH|ZSH|COMP|PS|HIST|LC_|READLINE|FUNC|PROMPT|MODULE)/

const SHELL_MANAGED = new Set([
  'PWD',
  'OLDPWD',
  'REPLY',
  'OPTARG',
  'OPTIND',
  'OPTERR',
  'RANDOM',
  'SECONDS',
  'LINENO',
  'HOME',
  'TMPDIR',
  'PATH',
  'CDPATH',
  'FPATH',
  'MANPATH',
  'MAILPATH',
  'MAIL',
  'MAILCHECK',
  'PSVAR',
  'WATCH',
  'FIGNORE',
  'GROUPS',
  'DIRSTACK',
  'PIPESTATUS',
  'UID',
  'EUID',
  'GID',
  'EGID',
  'PPID',
  'SHLVL',
  'COLUMNS',
  'LINES',
  'KEYBOARD_HACK',
  'ERRNO',
  'TTYIDLE',
  'EPOCHSECONDS',
  'EPOCHREALTIME',
  'USERNAME',
  'HOST',
  'HOSTNAME',
  'TMOUT',
  'SAVEHIST',
  'WORDCHARS',
  'TERM',
  'SHELL',
  'SRANDOM',
  'MATCH',
  'MBEGIN',
  'MEND',
])

const REFERENCE = new RegExp(String.raw`\$(?:(${NAME})|\{(${NAME})\})(?=\/|$)`, 'g')

const INITIAL_SCAN: ScanState = {
  single: false,
  double: false,
  backtick: false,
  escaped: false,
  escapeOutsideSingle: false,
  substitutionInDouble: false,
  masked: '',
}

const opensSubstitution = (state: ScanState, char: string, previous: string): boolean =>
  state.double && (char === '`' || (char === '(' && previous === '$'))

const advance = (state: ScanState, char: string, previous: string): Omit<ScanState, 'masked'> => {
  if (state.escaped) return { ...state, escaped: false }
  if (state.single) return char === "'" ? { ...state, single: false } : state
  if (char === '\\') return { ...state, escaped: true, escapeOutsideSingle: true }
  if (opensSubstitution(state, char, previous)) return { ...state, substitutionInDouble: true }
  if (char === '"') return { ...state, double: !state.double }
  if (state.double) return state
  if (char === "'") return { ...state, single: true }
  if (char === '`') return { ...state, backtick: !state.backtick }
  return state
}

const isQuoting = (before: ScanState, after: Omit<ScanState, 'masked'>): boolean =>
  before.single || before.double || after.single || after.double

const scanStep = (state: ScanState, char: string, previous: string): ScanState => {
  const next = advance(state, char, previous)
  return { ...next, masked: state.masked + (isQuoting(state, next) ? QUOTED_MASK : char) }
}

const scan = (text: string): ScanState =>
  text.split('').reduce((state, char, at, chars) => scanStep(state, char, chars[at - 1] ?? ''), INITIAL_SCAN)

const isQuotedAt = (command: string, index: number): boolean => {
  const state = scan(command.slice(0, index))
  return state.single || state.double || state.backtick || state.substitutionInDouble
}

const commandWordOf = (segment: string): string | undefined =>
  segment
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .find(word => !LEADING_KEYWORDS.has(word) && !new RegExp(String.raw`^${NAME}=`).test(word))

const isSafeCommandWord = (word: string | undefined): boolean =>
  word === undefined || (PLAIN_WORD.test(word) && !UNSAFE_COMMAND_WORDS.has(word))

const hasPlainCommandWords = (masked: string): boolean => masked.split(SEGMENT_BREAK).map(commandWordOf).every(isSafeCommandWord)

const isLexicallyPlain = (command: string): boolean => {
  const state = scan(command)
  return !state.escapeOutsideSingle && !state.substitutionInDouble && !state.backtick && hasPlainCommandWords(state.masked)
}

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const countOf = (text: string, pattern: string): number => text.match(new RegExp(pattern, 'g'))?.length ?? 0

const isOnlyReferencedElsewhere = (command: string, name: string): boolean => {
  const escaped = escapeForRegExp(name)
  const mentions = countOf(command, String.raw`(?<!\w)${escaped}(?!\w)`)
  const references = countOf(command, String.raw`\$${escaped}(?!\w)|\$\{${escaped}\}`)
  return mentions === references + 1
}

const isTrustedName = (name: string): boolean => TRUSTED_NAME.test(name) && !SHELL_PREFIXES.test(name) && !SHELL_MANAGED.has(name)

const stripQuotes = (value: string): string => (/^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value)

const leadingAssignments = (command: string): Assignment[] => {
  const match = command.match(LEADING_ASSIGNMENT)
  if (!match) return []
  return [{ name: match[1], value: stripQuotes(match[2]) }, ...leadingAssignments(command.slice(match[0].length))]
}

export const expand = (token: string, variables: Variables): string =>
  /['"\\]/.test(token)
    ? token
    : token.replace(REFERENCE, (raw, bare?: string, braced?: string) => variables.get(bare ?? braced ?? '') ?? raw)

export const variablesBefore = (command: string, index: number): Variables => {
  if (UNSAFE_TEXT.test(command) || !isLexicallyPlain(command) || isQuotedAt(command, index)) return NO_VARIABLES
  const isTrusted = ({ name }: Assignment): boolean => isTrustedName(name) && isOnlyReferencedElsewhere(command, name)
  return leadingAssignments(command)
    .filter(isTrusted)
    .reduce((variables, { name, value }) => new Map(variables).set(name, expand(value, variables)), new Map<string, string>())
}
