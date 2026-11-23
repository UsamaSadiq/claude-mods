import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { assess, holdReason } from '../hooks/danger'

const labelOf = (command: string): string | undefined => assess(command)?.label

describe('danger', () => {
  test('holds recursive deletes and names the targets', () => {
    expect(labelOf('rm -rf ./src /var/data')).toBe('recursive delete')
    expect(assess('rm -rf ./src /var/data')?.reach).toMatch(/\.\/src, \/var\/data/)
    expect(labelOf('sudo rm -fr /')).toBe('recursive delete')
  })

  test('lets disposable build directories go', () => {
    expect(labelOf('rm -rf node_modules')).toBeUndefined()
    expect(labelOf('rm -rf dist build/ .next')).toBeUndefined()
    expect(labelOf('rm -rf node_modules src')).toBe('recursive delete')
  })

  test('lets temp paths go', () => {
    expect(labelOf('rm -rf /tmp/build-cache')).toBeUndefined()
    expect(labelOf('rm -rf "/private/tmp/claude-502/scratch" /var/folders/xy/T/run')).toBeUndefined()
    expect(labelOf('rm -rf "$TMPDIR/out" ${TMPDIR}/more')).toBeUndefined()
    expect(labelOf('rm -rf /tmp/a node_modules')).toBeUndefined()
  })

  test('holds temp lookalikes and escapes', () => {
    expect(labelOf('rm -rf /tmp')).toBe('recursive delete')
    expect(labelOf('rm -rf /tmp/../etc')).toBe('recursive delete')
    expect(labelOf('rm -rf /tmpfoo')).toBe('recursive delete')
    expect(labelOf('rm -rf tmp/cache')).toBe('recursive delete')
    expect(labelOf('rm -rf /tmp/a /home/me/project')).toBe('recursive delete')
  })

  test('follows variables set to a temp path earlier in the command', () => {
    expect(labelOf('D=/private/tmp/claude-502/x/scratchpad/p073; rm -rf $D; pkgutil --expand-full a.pkg $D; rm -rf $D')).toBeUndefined()
    expect(labelOf('D="/tmp/x" && rm -rf "${D}"')).toBeUndefined()
    expect(labelOf("D='/tmp/x'\nrm -rf $D/sub")).toBeUndefined()
    expect(labelOf('W=/tmp/w; D=$W/x; rm -rf $D')).toBeUndefined()
    expect(labelOf('W=~/Projects/app; D=/tmp/check; tail $W/build.log; rm -rf $D; LC_ALL=C grep -c x $D/bin')).toBeUndefined()
  })

  test('trusts only assignments that lead the command', () => {
    expect(labelOf('tail build.log; D=/tmp/check; rm -rf $D')).toBe('recursive delete')
    expect(labelOf("export D='/tmp/x'; rm -rf $D/sub")).toBe('recursive delete')
  })

  test('lets real scratchpad cleanups through', () => {
    const scratch = '/private/tmp/claude-502/-Users-me-Desktop-app/22f4b9cb/scratchpad'
    expect(
      labelOf(
        `D=${scratch}/p073; rm -rf $D; pkgutil --expand-full ~/Projects/app.pkg $D >/dev/null; grep -o '<pkg-info[^>]*>' $D/buzz.pkg/PackageInfo | tr ' ' '\\n' | grep -E 'identifier|^version'; /usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' $D/buzz.pkg/Payload/Buzz.app/Contents/Info.plist; rm -rf $D`,
      ),
    ).toBeUndefined()
    expect(
      labelOf(
        `W=~/Projects/rebuild; P=$W/app.pkg; D=${scratch}/pkgcheck2; B=$D/buzz.pkg/Payload/Buzz.app/Contents/MacOS/Buzz; tail -8 $W/build.log | cut -c1-200; ls -l $P;\nrm -rf $D; pkgutil --expand-full $P $D >/dev/null; printf 'acl allow-askii-models: '; LC_ALL=C grep -a -c -F 'allow-askii-models' $B; rm -rf $D`,
      ),
    ).toBeUndefined()
    expect(
      labelOf(
        `D=${scratch}/goose-src; rm -rf $D; git clone -q --depth 1 --branch v1.57.0 --filter=blob:none --sparse https://github.com/aaif-goose/goose.git $D && cd $D && git sparse-checkout set crates/goose/src/providers >/dev/null && grep -rn -B3 -A12 'metadata discovery timed out' crates/goose/src/providers | head -60`,
      ),
    ).toBeUndefined()
  })

  test('holds variables it cannot pin to a temp path', () => {
    expect(labelOf('rm -rf $UNSET')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; D=~/src; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/../Users; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=$(pwd); rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=`pwd`; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=$(mktemp -d); rm -rf $D')).toBe('recursive delete')
    expect(labelOf('rm -rf $D; D=/tmp/x')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; if true; then D=/etc; fi; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; for D in /etc; do rm -rf $D; done')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; unset D; rm -rf $D/')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; read D; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; D+=/../etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; rm -rf ${D%/*}')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; rm -rf $DIR')).toBe('recursive delete')
  })

  test('holds assignments that do not run in the shell of the rm', () => {
    expect(labelOf('echo HOME=/tmp/x; rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('make PREFIX=/tmp/x install; rm -rf $PREFIX')).toBe('recursive delete')
    expect(labelOf('HOME=/tmp/x ls; rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('HOME=/tmp/x rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('(HOME=/tmp/x); rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('(D=/tmp/x); rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('false && HOME=/tmp/x; rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('false || D=/tmp/x; rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('f() { HOME=/tmp/x; }; rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('if false; then\nD=/tmp/x\nfi\nrm -rf $D/*')).toBe('recursive delete')
    expect(labelOf("echo 'x; D=/tmp/x'; rm -rf $D/*")).toBe('recursive delete')
    expect(labelOf('cat <<EOF >f\nHOME=/tmp/x\nEOF\nrm -rf $HOME')).toBe('recursive delete')
  })

  test('holds references another shell or a zsh suffix would expand', () => {
    expect(labelOf("D=/tmp/x; bash -c 'rm -rf $D/*'")).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; ssh host "rm -rf $D/*"')).toBe('recursive delete')
    expect(labelOf('D=/tmp/etc; rm -rf $D[5,8]')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; rm -rf $D:h:h/etc')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; rm -rf "$D"/../../etc')).toBe('recursive delete')
  })

  test('holds values it cannot read exactly', () => {
    expect(labelOf('D=/tmp/x"/../../etc"; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D="/tmp/x"/../../etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D="/Users/me/My Docs"; rm -rf "$D/tmp/x"')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x\\ /etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x:/etc; IFS=:; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/*; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=; rm -rf $D/*')).toBe('recursive delete')
  })

  test('holds rebinding through eval, sourcing and shell-specific forms', () => {
    expect(labelOf('D=/tmp/x; eval "D=/etc"; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; . ./env.sh; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; source .env; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; D[0]=/etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; : ${D::=/etc}; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; set -A D /etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; export "D"=/etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; N=D; declare $N=/etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; printf -vD %s /etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; print -v D /etc; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; { . ./env.sh; }; rm -rf $D')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; command . ./env.sh; rm -rf $D')).toBe('recursive delete')
  })

  test('holds assignments hidden by escapes, comments and nested quoting', () => {
    expect(labelOf('echo \\; HOME=/tmp/x; rm -rf $HOME')).toBe('recursive delete')
    expect(labelOf('echo \\\nD=/tmp/x; rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('false &&\nD=/tmp/x; rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('true |\nD=/tmp/x; rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('#; D=/tmp/x\nrm -rf $D/*')).toBe('recursive delete')
    expect(labelOf("D=/tmp/x; # '\nbash -c 'rm -rf $D/*'")).toBe('recursive delete')
    expect(labelOf("echo $'\\'; D=/tmp/x; ' \\'; rm -rf $D/*")).toBe('recursive delete')
    expect(labelOf(': "$(: "; D=/tmp/x; ")"; rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('D=/tmp/x; echo "$(bash -c \'rm -rf $D/*\')"')).toBe('recursive delete')
    expect(labelOf('(echo }; D=/tmp/x; true); rm -rf $D/*')).toBe('recursive delete')
    expect(labelOf('export() { :; }; export D=/tmp/x; rm -rf $D/*')).toBe('recursive delete')
  })

  const disguisedBuiltins = [
    'D=/tmp/x;# \'\nbash -c \'rm -rf $D/*; true\'',
    'DIR=/tmp/x; e\\val DI\\R=/etc; rm -rf $DIR',
    'N=D; C=ev; D=/tmp/x; ${C}al $N=/etc; rm -rf $D',
    'C=ev; D=/tmp/x; ${C}al D=/etc; rm -rf $D',
    'D=/tmp/x; \\. ./env.sh; rm -rf $D',
    "D=/tmp/x; '.' ./env.sh; rm -rf $D",
    'D=/tmp/x; "eval" D=/etc; rm -rf $D',
    "D=/tmp/x; printf '-v' D /etc; rm -rf $D",
    'D=/tmp/x; printf -- -vD /etc; rm -rf $D',
    'D=/tmp/x; noglob set -A D /etc; rm -rf $D',
    'D=/tmp/x; function f { :; }; rm -rf $D',
  ]

  for (const command of disguisedBuiltins) {
    test(`holds a disguised builtin: ${JSON.stringify(command)}`, () => {
      expect(labelOf(command)).toBe('recursive delete')
    })
  }

  test('does not expand a single-quoted target', () => {
    expect(labelOf("D=/tmp/x; rm -rf '$D/sub'")).toBe('recursive delete')
  })

  test('never trusts names the shell rebinds on its own', () => {
    expect(labelOf('cdpath=/tmp/x; CDPATH=/etc; rm -rf $cdpath')).toBe('recursive delete')
    expect(labelOf('CDPATH=/tmp/x; cdpath=/etc; rm -rf $CDPATH')).toBe('recursive delete')
    expect(labelOf('PS1=/tmp/x; PROMPT=/etc; rm -rf $PS1')).toBe('recursive delete')
    expect(labelOf('FUNCNAME=/tmp/x; rm -rf $FUNCNAME/*')).toBe('recursive delete')
    expect(labelOf('GROUPS=/tmp/x; rm -rf $GROUPS/*')).toBe('recursive delete')
    expect(labelOf('d=/tmp/x; rm -rf $d/*')).toBe('recursive delete')
    expect(labelOf('PWD=/tmp/x; cd ~; rm -rf $PWD/*')).toBe('recursive delete')
    expect(labelOf('OLDPWD=/tmp/x; cd /etc; cd ~; rm -rf $OLDPWD')).toBe('recursive delete')
    expect(labelOf('_=/tmp/x; : /etc; rm -rf $_')).toBe('recursive delete')
    expect(labelOf('REPLY=/tmp/x; read; rm -rf $REPLY')).toBe('recursive delete')
    expect(labelOf('OPTARG=/tmp/x; getopts a: o -a /etc; rm -rf $OPTARG')).toBe('recursive delete')
    expect(labelOf('HOME=/tmp/x; cd; rm -rf $HOME')).toBe('recursive delete')
  })

  test('names the resolved path when it holds', () => {
    expect(assess('D=~/src; rm -rf $D')?.reach).toMatch(/~\/src/)
  })

  test('checks every removal in a chained command', () => {
    expect(labelOf('rm -rf /tmp/a && rm -rf ~/project')).toBe('recursive delete')
    expect(assess('rm -rf /tmp/a; rm -rf ~/project')?.reach).toMatch(/~\/project/)
    expect(labelOf('rm -rf /tmp/a && rm -rf /tmp/b')).toBeUndefined()
  })

  test('holds force pushes but not leased ones', () => {
    expect(labelOf('git push --force origin main')).toBe('force push')
    expect(labelOf('git push -f')).toBe('force push')
    expect(labelOf('git push --force-with-lease')).toBeUndefined()
    expect(labelOf('git push origin main')).toBeUndefined()
  })

  test('holds history and working tree losses', () => {
    expect(labelOf('git reset --hard HEAD~3')).toBe('hard reset')
    expect(labelOf('git clean -fdx')).toBe('git clean')
    expect(labelOf('git branch -D old')).toBe('branch delete')
    expect(labelOf('git checkout -- .')).toBe('discard checkout')
    expect(labelOf('git status')).toBeUndefined()
  })

  test('holds destructive SQL and migrations', () => {
    expect(labelOf('psql -c "DROP TABLE users"')).toBe('SQL drop')
    expect(labelOf('python manage.py migrate')).toBe('migration')
    expect(labelOf('alembic downgrade -1')).toBe('migration')
    expect(labelOf('ls -la')).toBeUndefined()
  })

  test('explains the hold in one sentence', () => {
    expect(holdReason({ label: 'hard reset', reach: 'discards changes' })).toBe('cross-fire held a hard reset: it discards changes.')
  })
})

const asking = (on: On) => on('tool.check', () => ({ decision: 'allow' as const }))

describe('hook', () => {
  test('puts a destructive command to the person', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force' } })
    expect(verdict.decision).toBe('ask')
    expect(verdict.reason).toMatch(/force push/)
  })

  test('leaves ordinary commands to the usual rules', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
    expect(verdict.decision).toBe('allow')
  })

  test('ignores other tools', async ($, on) => {
    asking(on)
    const verdict = await $.tool.check({ tool: 'Read', input: { file_path: '/etc/hosts' } })
    expect(verdict.decision).toBe('allow')
  })
})
