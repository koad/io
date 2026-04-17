# projects/

This directory holds the actual work of the garden. Structure is freeform — the operator
creates what fits the work.

## Typical Shape

```
projects/
├── trading-engine/     — a deployable service
├── market-data/        — another service
└── research/           — non-deployable work
```

## Relationship to Doors

A door's `upstream` in `doors/<fqdn>/config.yaml` typically points to a running process
from `projects/`. The door is the public face; the project is the running service behind it.
They are linked by convention — the operator wires them at deploy time.

## Spec

VESTA-SPEC-119 §8 — Projects Convention
