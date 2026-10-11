export type Ringtone = 'done' | 'ship' | 'blocked' | 'oops'

export const MIN_GAP_MS = 1_500

const GIT_PUSH = /\bgit\s+push\b/
const PR_MERGE = /\bgh\s+pr\s+merge\b/

export const assetOf = (ringtone: Ringtone): string => `sounds/${ringtone}.wav`

export const isShipping = (call: { tool: string; command?: unknown }): boolean =>
  call.tool === 'Bash' && typeof call.command === 'string' && (GIT_PUSH.test(call.command) || PR_MERGE.test(call.command))

export const isQuietEnough = (lastPlayedAt: number, now: number): boolean => now - lastPlayedAt >= MIN_GAP_MS

type Turn = { agentId?: string; reason: string; durationMs: number }

export const ringtoneForTurn = (turn: Turn, minTurnMs: number): Ringtone | undefined => {
  if (turn.agentId !== undefined) return undefined
  if (turn.reason === 'error') return 'oops'
  if (turn.reason === 'answer' && turn.durationMs >= minTurnMs) return 'done'
  return undefined
}
