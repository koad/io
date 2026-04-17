<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/sign/`

> Clearsign-style authorization — human-readable intent with a Keybase saltpack signature attached.

## What this does

`sign` wraps a message in a cleartext block that states who authorized what, adds a UTC timestamp, and appends a Keybase saltpack signature. The plaintext is readable. The proof is cryptographic.

## Invocation

```bash
<entity> sign "authorized: koad/vulcan#42 — merge release"
echo "message" | <entity> sign
<entity> sign --help
```

## Output format

```
--- AUTHORIZED BY KOAD ---
authorized: koad/vulcan#42 — merge release
2026-04-17T18:30:00Z
--- KEYBASE SALTPACK SIGNATURE ---
BEGIN KEYBASE SALTPACK SIGNED MESSAGE. ...
END KEYBASE SALTPACK SIGNED MESSAGE.
--- END ---
```

## What it expects

- `keybase` — installed and logged in as the entity (or `$ENTITY`)
- Message via argument or stdin

## Notes

- Requires Keybase CLI authenticated as the signing entity.
- The signed payload includes the message, timestamp, and `signed-by: <entity>` line — not just the message alone.
- Use this to authorize merges, releases, trust bond changes, or any action requiring a cryptographic record.
- Exit 1 on empty message.
