# Specification: Sovereign Profiles

## Overview

Sovereign Profiles is a self-sovereign identity system for the Dark Passenger Chrome extension. Users can create cryptographic profiles with GPG keys, build social graphs with proofs, and sign messages for authentication across the web.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Sovereign Profiles UI                  │    │
│  │  • Profile List    • Key Management    • Proofs    │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              kbpgp-js (GPG Key Generation)          │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Chrome Storage (local/sync)            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ DDP
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    koad:io Daemon                            │
│  • Profile sync      • Proof verification                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### Profile Object

```javascript
{
  id: "profile_abc123",
  name: "My Identity",
  createdAt: timestamp,
  updatedAt: timestamp,
  publicKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----...",
  privateKeyEncrypted: "encrypted_key_data",
  keyFingerprint: "ABC123DEF456",
  
  // Social proofs
  proofs: [
    {
      id: "proof_xyz789",
      type: "dns-txt" | "url" | "twitter" | "github" | "website",
      identifier: "example.com" | "https://example.com/verify/...",
      verified: true,
      verifiedAt: timestamp,
      proofData: "verification token or signature"
    }
  ],
  
  // Settings
  isDefault: false,
  autoSignMessages: false
}
```

### Signed Message Object

```javascript
{
  id: "msg_abc123",
  profileId: "profile_abc123",
  content: "Hello world!",
  signature: "-----BEGIN PGP SIGNED MESSAGE-----...",
  signedAt: timestamp,
  signatureFingerprint: "ABC123DEF456"
}
```

---

## UI/UX Specification

### Profile Management Page

Located in extension settings: `Settings → Profiles`

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  SOVEREIGN PROFILES                              [+ New]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │   Profile Card      │  │   Profile Card      │          │
│  │   ─────────────     │  │   ─────────────     │          │
│  │   Name: Alice       │  │   Name: Work        │          │
│  │   Key: ABC1...DEF3  │  │   Key: 789A...      │          │
│  │   Proofs: 3/5       │  │   Proofs: 2/3       │          │
│  │   [Edit] [Delete]   │  │   [Edit] [Delete]   │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Profile Editor Modal

```
┌─────────────────────────────────────────────────────────────┐
│  CREATE PROFILE                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Profile Name:  [________________________]                   │
│                                                              │
│  ┌─ Key Generation ─────────────────────────────────────┐  │
│  │  Algorithm: RSA 4098  │  ECC P-256                  │  │
│  │                                                       │  │
│  │  Generate Keypair  [Generate]                        │  │
│  │  Status: ● Ready    Fingerprint: ABC1...DEF3         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ Social Proofs ──────────────────────────────────────┐  │
│  │                                                       │  │
│  │  [+ Add DNS TXT Proof]                               │  │
│  │  [+ Add URL Proof]                                    │  │
│  │  [+ Add Twitter]                                     │  │
│  │  [+ Add GitHub]                                      │  │
│  │  [+ Add Website]                                     │  │
│  │                                                       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                              │
│  [Cancel]                                    [Save Profile]  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Proof Types

#### DNS TXT Proof
- User enters domain (e.g., `example.com`)
- System generates verification token
- User adds TXT record: `koadproof=TOKEN`
- System verifies via DNS lookup

#### URL Proof
- User hosts file at `https://example.com/.well-known/koadproof`
- System fetches and verifies content
- Used for static site verification

#### Social Platform Proofs
- Twitter: Tweet verification token
- GitHub: Gist with verification token

### Signed Messages Panel

```
┌─────────────────────────────────────────────────────────────┐
│  SIGNED MESSAGES                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Create New Message ─────────────────────────────────┐  │
│  │  Profile: [Alice ▼]                                  │  │
│  │  Message: [________________________]                │  │
│  │                    [Sign Message]                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                              │
│  Recent Messages:                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ "Hello from my sovereign identity!"                 │  │
│  │ Signed by: Alice (ABC1...DEF3) | 2024-01-15        │  │
│  │ [Copy] [View Signature]                             │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## DDP Methods

### Profile Management

```
passenger.profiles.list
// Returns: Profile[]

passenger.profiles.create(name, publicKey, privateKeyEncrypted, keyFingerprint)
// Returns: { id, success }

passenger.profiles.update(id, updates)
// Returns: { success }

passenger.profiles.delete(id)
// Returns: { success }

passenger.profiles.setDefault(id)
// Returns: { success }
```

### Proof Management

```
passenger.proofs.add(profileId, proofType, identifier)
// Returns: { proofId, verificationToken }

passenger.proofs.verify(profileId, proofId)
// Returns: { verified: boolean, verifiedAt }

passenger.proofs.remove(profileId, proofId)
// Returns: { success }
```

### Message Signing

```
passenger.messages.sign(profileId, message)
// Returns: { signature, signedAt, fingerprint }

passenger.messages.verify(message, signature)
// Returns: { valid: boolean, fingerprint }
```

---

## Storage Schema

### chrome.storage.local

```javascript
{
  sovereignProfiles: {
    profiles: Profile[],
    messages: SignedMessage[],
    activeProfileId: string | null
  }
}
```

### chrome.storage.sync

```javascript
{
  sovereignProfilesSettings: {
    autoSignEnabled: boolean,
    defaultProfileId: string | null,
    showInToolbar: boolean
  }
}
```

---

## Meteor Package Structure

```
src/packages/koad-io-sovereign-profiles/
├── package.js
├── client/
│   ├── templates.html      # Profile UI templates
│   ├── styles.css         # Profile styling
│   └── logic.js           # Client-side logic
├── lib/
│   ├── kbpgp-bundle.js    # Bundled kbpgp library
│   └── crypto.js          # Key generation utilities
└── assets/
    └── icons/             # Profile-related icons
```

---

## Implementation Checklist

- [ ] Create Meteor package `koad:io-sovereign-profiles`
- [ ] Bundle kbpgp-js library
- [ ] Implement key generation using kbpgp
- [ ] Create profile CRUD UI in settings
- [ ] Implement DNS TXT proof verification
- [ ] Implement URL proof verification
- [ ] Implement signed message creation
- [ ] Add message verification feature
- [ ] Add profile to toolbar dropdown
- [ ] Write tests for key generation
- [ ] Write tests for proof verification

---

## File Locations

| Component | Location |
|-----------|----------|
| Package definition | `src/packages/koad-io-sovereign-profiles/package.js` |
| Templates | `src/packages/koad-io-sovereign-profiles/client/templates.html` |
| Client logic | `src/packages/koad-io-sovereign-profiles/client/logic.js` |
| Styles | `src/packages/koad-io-sovereign-profiles/client/styles.css` |
| Crypto lib | `src/packages/koad-io-sovereign-profiles/lib/crypto.js` |
| Settings integration | Add to `src/client/pages/settings.html` |
