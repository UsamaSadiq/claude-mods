import type { Counters } from '../types'

const WORD_SCALE: readonly [number, string][] = [
  [40, 'a tweet'],
  [300, 'a long email'],
  [1_000, 'a blog post'],
  [7_500, 'a short story'],
  [17_500, 'a novelette'],
]

const MINUTES_PER_EGG = 9

const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const times = (n: number): string => (n === 1 ? 'once' : `${withCommas(n)} times`)

const plural = (n: number, word: string, many = `${word}s`): string => `${withCommas(n)} ${n === 1 ? word : many}`

const wordsLike = (words: number): string => WORD_SCALE.find(([limit]) => words < limit)?.[1] ?? 'a novella'

const wordsLine = (words: number): string => `You typed ${plural(words, 'word')} to Claude, about ${wordsLike(words)}.`

const politenessLine = ({ continues, pleases }: Counters): string | undefined => {
  if (continues === 0 && pleases === 0) return undefined
  if (pleases === 0) return `You said "continue" ${times(continues)}.`
  if (continues === 0) return `You said "please" ${times(pleases)}. Claude appreciates it.`
  return `You said "continue" ${times(continues)} and "please" ${times(pleases)}.`
}

const toolsLine = ({ toolCalls, edits }: Counters): string =>
  `Claude ran ${plural(toolCalls, 'tool')} and edited ${plural(edits, 'file')}.`

const shippingLine = ({ commits, pushes, merged }: Counters): string =>
  `${plural(commits, 'commit')}, ${plural(pushes, 'push', 'pushes')}, ${plural(merged, 'PR')} merged.`

const denialsLine = ({ denials }: Counters): string | undefined =>
  denials === 0 ? undefined : `Blocked ${times(denials)}. Nice try.`

const longestTurnLine = ({ longestTurnMs }: Counters): string | undefined => {
  const minutes = Math.floor(longestTurnMs / 60_000)
  if (minutes === 0) return undefined
  const eggs = Math.floor(minutes / MINUTES_PER_EGG)
  return eggs === 0
    ? `Longest turn: ${minutes}m.`
    : `Longest turn: ${minutes}m, long enough to boil ${plural(eggs, 'egg')}.`
}

export const reportLines = (today: Counters, level: number, xp: number): string[] =>
  [
    wordsLine(today.words),
    politenessLine(today),
    toolsLine(today),
    shippingLine(today),
    denialsLine(today),
    longestTurnLine(today),
    `Pet: Lv${level}, ${withCommas(xp)} XP.`,
  ].filter((line): line is string => line !== undefined)

export const report = (face: string, lines: readonly string[]): string =>
  [`${face}  Today's silly stats`, ...lines.map(line => `· ${line}`)].join('\n')
