import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import { assetOf, isQuietEnough, isShipping, ringtoneForTurn } from './sounds'
import type { Ringtone } from './sounds'

const DEFAULT_VOLUME = 0.6
const DEFAULT_MIN_TURN_SECONDS = 20

const lastPlayedAt = atom({ plugin: 'ringtones', key: 'lastPlayedAt' } as const, 0)

const skipFailedRun = () => undefined

const wasDenied = (result: ToolCallResult): boolean => 'deny' in result && result.deny !== undefined

type Settings = { isMuted: boolean; volume: number; minTurnMs: number }

const settingsOf = (options: Record<string, unknown>): Settings => ({
  isMuted: options.isMuted === true,
  volume: Number(options.volume ?? DEFAULT_VOLUME),
  minTurnMs: Number(options.minTurnSeconds ?? DEFAULT_MIN_TURN_SECONDS) * 1_000,
})

const play = async ($: EngineInterface, ringtone: Ringtone, volume: number) => {
  const [clock, previous] = await Promise.all([$.clock.now(), read($, lastPlayedAt)])
  if (!isQuietEnough(previous, clock)) return
  await update($, lastPlayedAt, () => clock)
  await $.audio.play({ asset: assetOf(ringtone) }, { gain: volume })
}

const ring = ($: EngineInterface, settings: Settings, ringtone: Ringtone) => {
  if (!settings.isMuted) void play($, ringtone, settings.volume).catch(skipFailedRun)
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    const ringtone = ringtoneForTurn(e, settings.minTurnMs)
    if (ringtone) ring($, settings, ringtone)
    return completed
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (wasDenied(result)) ring($, settings, 'blocked')
    else if (!result.isError && isShipping(e)) ring($, settings, 'ship')
    return result
  }).catch(($, e, next) => next(e))
}
