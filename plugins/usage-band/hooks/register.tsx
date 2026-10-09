import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageWindow } from '../types'
import { hintTail } from './format'

const REFRESH_MS = 60_000

const windows = atom({ plugin: 'usage-band', key: 'windows' } as const, [] as UsageWindow[])
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

const toWindows = (rateLimits: readonly UsageWindow[]): UsageWindow[] =>
  rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))

const refresh = async ($: EngineInterface) => {
  const [usage, clock] = await Promise.all([$.session.usage(), $.clock.now()])
  await Promise.all([
    update($, windows, () => toWindows(usage.rateLimits)),
    update($, now, () => clock),
  ])
}

const skipFailedRun = () => undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(REFRESH_MS, () => void refresh($).catch(skipFailedRun))
    await refresh($)
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, windows, () => toWindows(e.rateLimits))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [current, clock] = await Promise.all([read($, windows), read($, now)])
    const tail = [e.props.tail, hintTail(current, clock)].filter(Boolean).join('  ')
    return next({ ...e, props: { ...e.props, tail } })
  })
}
