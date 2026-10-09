# claude-mods

Small, fun and useful mods for [Claude Code](https://claude.com/claude-code). Each one is a single command away.

| Mod | What it does |
|---|---|
| [terminal-pet](#terminal-pet) | A cat in the empty prompt box that reacts to your day, plus `/pet-stats` silly stats |
| [usage-band](#usage-band) | Your session and weekly plan usage, always visible on the prompt hint line |

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install terminal-pet --marketplace UsamaSadiq/claude-mods
```

```
/plugin install usage-band --marketplace UsamaSadiq/claude-mods
```

The first install asks to add the `UsamaSadiq/claude-mods` marketplace (answer `y`) and which scope to install into. The mod is active right away, with no restart.

To remove one: `/plugin uninstall <mod>`.

## terminal-pet

A cat lives in your empty prompt box and reacts to what's happening:

| Mood | Cat | When |
|---|---|---|
| playing | `ฅ^•ﻌ•^ฅ~ playing` | for 3 minutes after a successful `git push` or `gh pr merge` |
| hissing | `(=ↀДↀ=) hiss!` | for 2 minutes after a tool call is blocked |
| sleeping | `(=-ω-=) zzz` | 11pm to 6am |
| yawning | `(=^OωO^=) yawn` | 9pm to 11pm |
| stretching | `/ᐠ - ˕ -マ stretch?` | after 2 hours of prompting without a 15-minute break |
| eager | `/ᐠ｡ꞈ｡ᐟ\ eager` | you sent a prompt in the last 10 minutes |
| resting | `ᓚᘏᗢ resting` | otherwise |

The first matching row wins. Times are your machine's local time.

**Levels.** Commits earn 1 XP, pushes 2 and merged PRs 5. XP adds up across sessions and days. The cat earns a star at Lv3 and a crown at Lv6:

```
♔ᓚᘏᗢ resting Lv7
```

**Suggestions.** When Claude suggests your next prompt, the cat sits in front of it:

```
ᓚᘏᗢ resting Lv3  run the tests
```

Accepting the suggestion sends only the suggestion. If you accidentally submit the cat alone, it's dropped and nothing is sent.

**Silly stats.** Type `/pet-stats` for today's numbers across all your sessions:

```
ᓚᘏᗢ resting Lv3  Today's silly stats
· You typed 2,341 words to Claude, about a short story.
· You said "continue" 14 times and "please" 3 times.
· Claude ran 96 tools and edited 12 files.
· 3 commits, 2 pushes, 1 PR merged.
· Blocked 2 times. Nice try.
· Longest turn: 23m, long enough to boil 2 eggs.
· Pet: Lv3, 42 XP.
```

The same report pops up once a day after the report hour.

**Settings** (in `/config`, or asked for at install):

| Setting | Default | Meaning |
|---|---|---|
| `reportHour` | `18` | Local hour after which the daily report pops up once. `-1` turns it off. |

## usage-band

Adds your plan usage to the dim hint line under the prompt, with time left until each window resets:

```
? for shortcuts · * Session 27% · 1h 52m  * Weekly 45% · 4d 19h
```

It refreshes every minute, and straight away whenever Claude Code reports new rate-limit figures. Until the first reading arrives it shows `* Usage: waiting for the first reading`.

## Using them together

Both mods are built to share the screen. usage-band adds its text after anything another mod puts on the hint line, and terminal-pet uses the prompt box, so neither overwrites the other.

## Developing

Each mod lives in `plugins/<name>/`: a `.claude-plugin/plugin.json` manifest, a hooks module in `hooks/`, its state types in `types/` and tests in `tests/`.

```
claude --plugin-dir plugins/terminal-pet   # run a session with your working copy
claude plugin validate plugins/terminal-pet
claude plugin test plugins/terminal-pet
```

CI runs validate and test for every mod on each push and pull request.

## License

[MIT](LICENSE)
