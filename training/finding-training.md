# Finding Training in the Kingdom

> Training isn't centralized. It lives where the code it teaches lives. Here's how to find it.

## The mental model

The kingdom has training material at **many locations**, not just one. Each location is valid, each serves a purpose, and each is discoverable by the same convention: a `training/` folder sitting alongside the code, and inline `PRIMER:` comments inside the code itself.

```
~/.koad-io/training/                       ← master: entry, syllabi, graduated lessons
~/.koad-io/packages/<pkg>/training/        ← framework-package lessons
~/.forge/packages/<pkg>/training/          ← forge-package lessons
~/.<entity>/training/                      ← entity-owned lessons
~/.ecoincore/packages/<pkg>/training/      ← ecoincore-package lessons
```

Plus inline `PRIMER:` comments scattered across every `.js`, `.html`, `.css`, `.sh`, `.md` file in the kingdom.

## Three ways to find training when you need it

### 1. Grep for `PRIMER:`

Every teachable moment in the code has one of these nearby:

```bash
grep -r "PRIMER:" ~/.koad-io ~/.forge ~/.ecoincore ~/.<entity> 2>/dev/null | head
```

Each hit points you to a short inline lesson + a link to the longer training file.

### 2. List `training/` folders

Find every training folder in the kingdom:

```bash
find ~ -type d -name 'training' 2>/dev/null | grep -v node_modules | grep -v '\.meteor/local'
```

Walk them when you're exploring a topic.

### 3. Use the kingdom search

`search` (the kingdom search tool) indexes training/ folders and can be scoped:

```bash
search "session.set" --related
search --echo "navigation"
search --where topic=layout
```

## Why distributed, not centralized?

The obvious question: why not one big docs folder?

**Because lessons travel with the code they describe.**

- When a package is cloned or carved, its lessons come along. The new clone isn't orphaned from teaching.
- When code evolves, the nearby lesson is right there to update. Drift is minimized.
- When a package maintainer writes a lesson, it's in THEIR repo. Ownership is clear.
- When a user looks at unfamiliar code, they glance at the adjacent `training/` folder. Context is immediate.

Centralized docs rot when the code they describe moves. Co-located training stays coherent.

## The graduation ladder

Most lessons start local. Some graduate.

```
<package>/training/<lesson>.md              ← raw teaching, close to code
          ↓  (over time, if broadly applicable)
~/.koad-io/training/<topic>/<lesson>.md     ← canonical, progressively-readable
```

Graduation is not automatic — it's a deliberate move when a lesson has proven it serves many readers, not just readers of one package.

## Starting a new lesson

If you find yourself explaining something twice, write a lesson:

1. **Is it about ONE package?** → Write it in `<that-package>/training/<topic>.md`
2. **Does it span packages?** → Write it as a syllabus `index.md` at `~/.koad-io/training/<topic>/`, with pointers to per-package lessons that will follow
3. **Is it the kingdom-level meta?** → Write it here at the master level

And add an inline `PRIMER:` at the teachable moment in the code itself, pointing to your new lesson.

## Related

- [`PRIMER.md`](./PRIMER.md) — the training folder's convention
- `search` — kingdom-wide search (indexes training/ folders)
- `~/.documentation/` — koad's personal manual at book.koad.sh (separate system; broader scope)

## See also (examples in the wild)

- `~/.forge/packages/navigation/training/body-merge.md` — lesson local to a package
- `~/.koad-io/training/layout/index.md` — topical syllabus pointing into packages
- `~/.forge/packages/navigation/client/body.html` — code file with an inline PRIMER
