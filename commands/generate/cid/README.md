# generate cid

Derives a stable 17-character Content ID (CID) from a human name or handle string. The input is normalized (lowercased, non-alphanumeric chars stripped), then SHA-256 hashed, then the first 17 bytes are mapped through the `EASILY_RECOGNIZABLE` alphabet (`23456789ABCDEFGHJKLMNPQRSTWX…`). The result is URL-safe, case-distinguishing, and collision-resistant enough for entity and trust-bond identifiers within the koad:io ecosystem.

```bash
koad-io generate cid "Addison Cameron-Huff"
# → vPxbwQ4JP55aenfD4

koad-io generate cid addisoncameronhuff
# → vPxbwQ4JP55aenfD4   (same — normalization is idempotent)

echo "koad" | koad-io generate cid
# → TysPFWq8Nr5LZQQnM
```

Source of truth: `~/.koad-io/packages/core/both/global-helpers.js` — `koad.generate.cid()`. This CLI is a byte-identical mirror of that function, safe to call offline when filing trust bonds without a running Meteor instance.
