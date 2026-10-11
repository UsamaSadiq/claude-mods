import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { isDue, resumeTime, shouldArmAfter, waitLabel } from './limit'
import type { Settings } from './limit'
import { settingsOf } from './limit'

const NOT_ARMED = 0
const STATUS_REFRESH_MS = 60_000

const resumeAt = atom({ plugin: 'session-resume', key: 'resumeAt' } as const, NOT_ARMED)

const storeKey = (sessionId: string): string => `resume-at:${sessionId}`

const skipFailedRun = () => undefined

const inBackground = (run: Promise<unknown>): void => void run.catch(skipFailedRun)

const showCountdown = async ($: EngineInterface) => {
  const [target, clock] = await Promise.all([read($, resumeAt), $.clock.now()])
  $.ui.status(target === NOT_ARMED ? undefined : `resuming in ${waitLabel(target - clock)}`)
}

const disarm = async ($: EngineInterface) => {
  const sessionId = await $.session.id()
  await Promise.all([update($, resumeAt, () => NOT_ARMED), $.store.set(storeKey(sessionId), NOT_ARMED)])
  $.ui.status(undefined)
}

const resume = async ($: EngineInterface, target: number, settings: Settings) => {
  const [armed, clock] = await Promise.all([read($, resumeAt), $.clock.now()])
  if (!isDue(target, armed, clock)) return
  await disarm($)
  $.ui.toast('session-resume: the limit has reset, picking the session back up.')
  await $.prompt.submit({ text: settings.message, asUser: true })
}

const schedule = ($: EngineInterface, target: number, clock: number, settings: Settings) => {
  $.clock.after(Math.max(0, target - clock), () => inBackground(resume($, target, settings)))
}

const arm = async ($: EngineInterface, target: number, settings: Settings) => {
  const [sessionId, clock] = await Promise.all([$.session.id(), $.clock.now()])
  await Promise.all([update($, resumeAt, () => target), $.store.set(storeKey(sessionId), target)])
  schedule($, target, clock, settings)
  await showCountdown($)
  $.ui.toast(`session-resume: limit reached. Will send "${settings.message}" in ${waitLabel(target - clock)}. Type anything to cancel.`)
}

const armIfLimited = async ($: EngineInterface, settings: Settings) => {
  const [usage, clock] = await Promise.all([$.session.usage(), $.clock.now()])
  const target = resumeTime(usage.rateLimits, clock, settings)
  if (target !== undefined) await arm($, target, settings)
}

const restoreAfterReload = async ($: EngineInterface, settings: Settings) => {
  const [sessionId, clock] = await Promise.all([$.session.id(), $.clock.now()])
  const stored = Number((await $.store.get(storeKey(sessionId))) ?? NOT_ARMED)
  if (stored === NOT_ARMED) return
  if (stored + settings.maxWaitMs < clock) return disarm($)
  await update($, resumeAt, () => stored)
  schedule($, stored, clock, settings)
  await showCountdown($)
}

const statusText = async ($: EngineInterface): Promise<string> => {
  const [target, clock] = await Promise.all([read($, resumeAt), $.clock.now()])
  return target === NOT_ARMED ? 'session-resume is idle.' : `session-resume will continue in ${waitLabel(target - clock)}.`
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(STATUS_REFRESH_MS, () => inBackground(showCountdown($)))
    await $.command
      .register({ name: 'session-resume', description: 'Show or cancel the pending automatic resume ("cancel" to stop it)' })
      .catch(skipFailedRun)
    await restoreAfterReload($, settings).catch(skipFailedRun)
    return started
  })

  on('command.run', { command: 'session-resume' }, async ($, e) => {
    if (e.args.trim() !== 'cancel') return { text: await statusText($) }
    await disarm($)
    return { text: 'session-resume cancelled.' }
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (shouldArmAfter(e)) inBackground(armIfLimited($, settings))
    return completed
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' && (await read($, resumeAt)) !== NOT_ARMED) await disarm($)
    return next(e)
  }).catch(($, e, next) => next(e))
}
