import type { EngineInterface, Register } from 'claude-code'
import { hasUrdu, toPage } from './render'

const DIR = '/tmp/claude-urdu-reader'
const PAGE_PATH = `${DIR}/last.html`
const ANSWER_PATH = `${DIR}/last-answer.txt`
const STATUS_HINT = 'Urdu in last reply: /urdu to read it'

async function savedAnswer($: EngineInterface): Promise<string | undefined> {
  return (await $.fs.exists(ANSWER_PATH)) ? $.fs.read(ANSWER_PATH) : undefined
}

async function writeAndOpen($: EngineInterface, text: string): Promise<string> {
  await $.fs.write(PAGE_PATH, toPage(text, new Date().toLocaleString()))
  const opened = await $.process.run(['open', PAGE_PATH])
  return opened.exitCode === 0
    ? `Opened in your browser: ${PAGE_PATH}`
    : `Saved to ${PAGE_PATH}; open it in a browser.`
}

export const register: Register = on => {
  let lastUrduAnswer: string | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.command.register({
      name: 'urdu',
      description: "Open the last reply's Urdu in the browser, right-to-left",
      argumentHint: '[text to show instead]',
    })
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined || e.isAborted) return ended
    if (hasUrdu(e.answer)) {
      lastUrduAnswer = e.answer
      await $.fs.write(ANSWER_PATH, e.answer)
      $.ui.status(STATUS_HINT)
    } else {
      $.ui.status(undefined)
    }
    return ended
  })

  on('command.run', { command: 'urdu' }, async ($, e) => {
    const text = e.args.trim() !== '' ? e.args : (lastUrduAnswer ?? await savedAnswer($))
    if (text === undefined || !hasUrdu(text)) {
      return { text: 'No Urdu found in my recent replies. Pass text to show it: /urdu <text>' }
    }
    return { text: await writeAndOpen($, text) }
  })
}
