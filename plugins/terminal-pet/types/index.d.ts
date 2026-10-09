export type Counters = {
  prompts: number
  words: number
  continues: number
  pleases: number
  toolCalls: number
  edits: number
  commits: number
  pushes: number
  merged: number
  denials: number
  longestTurnMs: number
}

export type Moments = { lastCelebration: number; lastDenial: number; streakStart: number; lastPrompt: number }

declare module 'claude-code' {
  interface PluginState {
    'terminal-pet': {
      day: string
      counters: Counters
      othersToday: Counters
      pastXp: number
      moments: Moments
      suggestion: string
      shownFace: string
    }
  }
}
