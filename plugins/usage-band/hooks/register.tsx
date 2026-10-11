import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageWindow } from '../types'
import { usageGauges, WAITING_SUMMARY } from './format'

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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const [current, clock] = await Promise.all([read($, windows), read($, now)])
    const { Box, Text } = $.ui.resolve(e)
    const gauges = usageGauges(current, clock)
    const bar = (
      <Box flexDirection="row" flexWrap="wrap">
        {gauges.length === 0 && <Text dimColor>{WAITING_SUMMARY}</Text>}
        {gauges.map(gauge => (
          <Box key={gauge.label} marginRight={3}>
            <Text dimColor>{gauge.label} </Text>
            <Text color={gauge.tone}>{gauge.cells}</Text>
            <Text dimColor> {gauge.percent}</Text>
            {gauge.resetsIn && <Text dimColor> · {gauge.resetsIn}</Text>}
          </Box>
        ))}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{bar}</Box> : bar
  })
}
