export type Page = { path: string; text: string; isTruncated: boolean }

declare module 'claude-code' {
  interface PluginState {
    'render-md': { page: Page; recent: string[]; cwd: string }
  }
}
