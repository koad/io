# Technical Specification: Sovereign Identity

## Overview

Cryptographic identity system using entity keypairs for signing, verification, and passwordless authentication.

## Key Management

### Key Generation
- Algorithm: Ed25519 (signing), X25519 (encryption)
- Generated on first entity creation
- Stored in entity's keyring

### Key Storage
```
~/.koad-io/entities/<entity>/keys/
├── signingKey.pub
├── signingKey.sec
├── encryptionKey.pub
└── encryptionKey.sec
```

## DDP Methods

### `identity.sign`
Sign arbitrary data with entity's private key

**Params**:
```javascript
{
  data: String,      // data to sign
  encoding: "base64" | "hex" | "utf8"
}
```

**Returns**:
```javascript
{
  signature: String,
  publicKey: String,
  algorithm: "Ed25519"
}
```

### `identity.verify`
Verify a signature

**Params**:
```javascript
{
  data: String,
  signature: String,
  publicKey: String
}
```

**Returns**:
```javascript
{
  valid: Boolean,
  signer: String      // entity handle
}
```

### `identity.getPublicKey`
Get entity's public key for sharing

**Params**: none

**Returns**:
```javascript
{
  publicKey: String,
  handle: String,
  algorithm: "Ed25519"
}
```

## Use Cases

### Passwordless Auth
1. Website requests signature of challenge
2. User approves via extension popup
3. Extension signs challenge with entity key
4. Website verifies and grants access

### Protocol Assertions
- Verify domain ownership via signed statements
- Prove identity without centralized IdP

### Data Verification
- Sign notes/warnings
- Others can verify source

## Implementation Files

- Background: `dist/background/identity.js`
- Popup handlers: `dist/panes/popup/identity.js`
