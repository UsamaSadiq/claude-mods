import { expect, test } from 'claude-code/testing'
import { hasUrdu, toPage } from '../hooks/render'

const URDU = 'آئین نے ۱۹۸۸ء تک اردو کا وعدہ کیا تھا۔'

test('detects Urdu and lays it out right-to-left', async () => {
  expect(hasUrdu(URDU)).toBe(true)
  expect(hasUrdu('Only English here.')).toBe(false)
  const page = toPage(`**Heading**\n\n${URDU}`, 'now')
  expect(page).toContain('dir="rtl" lang="ur" class="ur"')
  expect(page).toContain('<strong>Heading</strong>')
})

test('/urdu writes the page and opens it', async ($, on) => {
  const written: string[] = []
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.write', (_, e) => { written.push(e.path); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'urdu', args: URDU })

  expect(written).toEqual(['/tmp/claude-urdu-reader/last.html'])
  expect(ran.text).toContain('Opened in your browser')
})

test('/urdu falls back to the saved reply after a reload', async ($, on) => {
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: URDU }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'urdu', args: '' })

  expect(ran.text).toContain('Opened in your browser')
})

test('/urdu with nothing saved says so', async ($, on) => {
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: false }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'urdu', args: '' })

  expect(ran.text).toContain('No Urdu found')
})
