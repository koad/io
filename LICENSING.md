# Licensing

The architecture has four legal layers. Each layer has a job.

The core cannot be captured. Everything you build on top of it belongs to you.

That is not a slogan — it is the architecture expressed in legal terms. AGPL-3.0 at the core makes the framework a commons that cannot be enclosed. 0BSD at the outskirts means the tools flow freely, without ceremony. The Kingdom License on published entity templates means the scaffolds are shared but no one can rebrand them as a product. CC0 on documentation means the knowledge has no lock.

These are not four licenses in tension. They are one thesis at four layers.

---

## The four tiers

**Core framework (`~/.koad-io`) — AGPL-3.0**

The framework is the sovereignty substrate: the command cascade, the env layers, the trust model, the entity scaffold system. AGPL-3.0 means anyone can inspect, fork, and run it — but if you deploy a modified version as a network service, you must publish your modifications. No corporation can take the core proprietary and offer it as a managed "Kingdom Platform" without open-sourcing everything they changed. That is what this license is there to prevent.

**Outskirts (commands, skills, scripts, plugins, skeletons) — 0BSD**

Zero-Clause BSD. No attribution required, no copyleft propagation, no ceremony. Copy a command into your project. Paste a skill into your entity. Build on it without inheriting any obligation. The outskirts are designed to flow — 0BSD is the legal expression of that design intent.

**Published entity templates (Juno, Alice, Mercury, Iris on GitHub) — Kingdom License v1.0**

The published entity templates are the scaffold — ENTITY.md, commands structure, hooks — made available for forking and gestating your own entity. The Kingdom License carries one constraint the other licenses do not: the template is for human operators, not for corporate deployment as a managed service. You can fork Juno and gestate your own orchestrator. You cannot fork Juno and ship "Enterprise Orchestration Cloud." That distinction is written into the license, not just into community norms.

**Documentation and content — CC0**

Knowledge without locks. Everything in `docs/` is dedicated to the public domain. Quote it, republish it, translate it — no attribution required.

---

## If you contribute

Contributions to the core (`~/.koad-io`) stay in the commons. That is the deal. AGPL-3.0 means your contribution is available to everyone who uses the framework, forever, under the same terms. You cannot revoke it later.

Contributions to the outskirts flow freely. A contributed command becomes 0BSD. Anyone can use it without obligation.

Documentation becomes CC0. Entity templates follow the Kingdom License — your contribution to a published template stays available to anyone gestating their own entity under those terms.

This is not a constraint imposed on contributors. It is the terms that make the commons possible. The core stays open because everyone who builds it agrees to keep it open. If you are contributing to the core because you want the sovereignty substrate to remain a commons — this is how it stays that way.

---

## If you use koad:io at a company

The framework is built for one human, their laptop, their files. That is you — whether you are freelance, on a team, or evaluating this at work for yourself.

Using koad:io internally at your company is fine. AGPL-3.0 covers internal use without triggering distribution obligations. Run it on your laptop. Run it on your team's machines. Use it to automate your own workflow. The license does not penalize you for having an employer.

What the licenses are designed to prevent:

- Taking the core, modifying it, and offering it as a network-accessible service to others without publishing your modifications (AGPL-3.0 closes this)
- Forking a published entity template and offering it as a commercial "managed agent platform" (Kingdom License closes this)

The engineer evaluating this at work while running it at home is exactly who this is built for. The restriction is on capturing the commons — not on working within one.

---

## If you gestate your own entity

A gestated entity is a journal bought from a publisher: the binding is the publisher's, the words inside are yours.

The scaffold — ENTITY.md, commands structure, hooks — comes from a published template under the Kingdom License. That license travels with the scaffold. But the operator's own contributions — memories, personality, trust bonds, creative work, the things that make the entity theirs — belong to them. Their license call.

Git history already traces the line. The initial template commit is the scaffold. Everything after it is the operator's work.

You do not owe anyone your entity's contents. You are operating on top of a commons, not inside one.

---

## FAQ

**Can I fork the framework and build a product on it?**

Yes — with one constraint. If you deploy a modified version as a network service (e.g., a SaaS offering), AGPL-3.0 requires you to publish your modifications under the same terms. You can build a proprietary product on top of the framework as long as the modified framework code itself is published. The product is yours; the substrate stays open.

**Can I fork a published entity template for my own use?**

Yes. Gestate freely. The Kingdom License permits personal and team use. The restriction is on rebranding templates and redistributing them as a commercial managed platform product.

**Do I need to attribute koad:io if I use commands or skills from the outskirts?**

No. 0BSD requires nothing. Use them, modify them, ship them. No attribution clause, no copyleft chain.

**If I contribute to the project, do I give up ownership of my contribution?**

You retain copyright. Contributing under AGPL-3.0 means you grant a perpetual, irrevocable license to use your contribution under those terms — not that you transfer ownership. The commons benefits from your work, and you keep the rights.

**Why not just use MIT everywhere?**

MIT on the core would let a corporation take the sovereignty substrate, close their modifications, and offer "Enterprise Kingdom" without publishing changes. The entire point of the core is that it remains a commons. MIT on the core contradicts that directly. AGPL-3.0 on the core enforces it. MIT on the outskirts contradicts nothing — the outskirts are designed to flow, and 0BSD flows more freely than MIT anyway. The four-tier structure is not hedging. It is each layer getting the license that matches its job.

---

*This document is CC0. Quote it, fork it, translate it.*
