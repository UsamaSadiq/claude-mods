import type { Moments } from '../types'
import { localHour } from './time'

export type Mood = 'playing' | 'hissing' | 'sleeping' | 'yawning' | 'stretching' | 'eager' | 'resting'

const MINUTE = 60_000
const PLAYING_MS = 3 * MINUTE
const HISSING_MS = 2 * MINUTE
const EAGER_MS = 10 * MINUTE
const BREAK_DUE_MS = 120 * MINUTE
const BREAK_GAP_MS = 15 * MINUTE
const YAWN_FROM_HOUR = 21
const SLEEP_FROM_HOUR = 23
const WAKE_HOUR = 6

const CATS: Record<Mood, string> = {
  playing: 'ฅ^•ﻌ•^ฅ~ playing',
  hissing: '(=ↀДↀ=) hiss!',
  sleeping: '(=-ω-=) zzz',
  yawning: '(=^OωO^=) yawn',
  stretching: '/ᐠ - ˕ -マ stretch?',
  eager: '/ᐠ｡ꞈ｡ᐟ\\ eager',
  resting: 'ᓚᘏᗢ resting',
}

const BADGES: readonly { fromLevel: number; badge: string }[] = [
  { fromLevel: 6, badge: '♔' },
  { fromLevel: 3, badge: '⋆' },
  { fromLevel: 1, badge: '' },
]

export const levelOf = (xp: number): number => Math.floor((1 + Math.sqrt(1 + 0.8 * xp)) / 2)

const isAsleep = (hour: number): boolean => hour >= SLEEP_FROM_HOUR || hour < WAKE_HOUR

const isYawning = (hour: number): boolean => hour >= YAWN_FROM_HOUR && hour < SLEEP_FROM_HOUR

const within = (since: number, now: number, ms: number): boolean => since > 0 && now - since < ms

export const moodOf = (moments: Moments, now: number): Mood => {
  const hour = localHour(now)
  if (within(moments.lastCelebration, now, PLAYING_MS)) return 'playing'
  if (within(moments.lastDenial, now, HISSING_MS)) return 'hissing'
  if (isAsleep(hour)) return 'sleeping'
  if (isYawning(hour)) return 'yawning'
  if (moments.streakStart > 0 && now - moments.streakStart >= BREAK_DUE_MS) return 'stretching'
  return within(moments.lastPrompt, now, EAGER_MS) ? 'eager' : 'resting'
}

export const faceOf = (mood: Mood, level: number): string => {
  const badge = BADGES.find(candidate => level >= candidate.fromLevel)?.badge ?? ''
  return `${badge}${CATS[mood]} Lv${level}`
}

export const afterPrompt = (moments: Moments, now: number): Moments => ({
  ...moments,
  streakStart: now - moments.lastPrompt >= BREAK_GAP_MS ? now : moments.streakStart,
  lastPrompt: now,
})

const PET_SEPARATOR = '  '

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const LEADING_PET = new RegExp(
  `^(?:${BADGES.map(({ badge }) => escaped(badge)).filter(Boolean).join('|')})?` +
    `(?:${Object.values(CATS).map(escaped).join('|')}) Lv\\d+(?: {2}|\\s*$)`,
)

export const withPet = (face: string, suggestion: string): string =>
  suggestion ? `${face}${PET_SEPARATOR}${suggestion}` : face

export const withoutPet = (text: string): string => text.replace(LEADING_PET, '')
