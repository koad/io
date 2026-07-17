# koad:io parsers

`summary` loads parser modules from this folder.

v1 parser set:
- `session`
- `flight`
- `jsonl`
- `json`
- `markdown-frontmatter`
- `directory`
- `message`

Contract:
- export `parser`
- `parser.name`
- optional `parser.aliases`
- `parser.canParse(ctx)` returns a score
- `parser.summarize(ctx)` returns `{ summary, data, warnings }`

Drop a new `*.mjs` parser here and the host will discover it automatically.
