// UserMemories — shared Meteor collection per VESTA-SPEC-134 §4.1
// Phase 0 bootstrap: collection definition only. No publications, no methods.
// Phase 2 adds write/read paths. Phase 3 adds signal extraction.
//
// Schema (every field, exactly as specified in SPEC-134 §4.1):
//   _id          String    stable document ID, assigned at insert
//   spec         String    always "VESTA-SPEC-134"
//   user_id      String    Meteor accounts users._id
//   entity       String    entity name, lowercase, e.g. "alice", "juno"
//   cid          String    IPFS CID of the encrypted memory blob
//   captured_at  Date      when the <<REMEMBER>> signal was emitted
//   captured_from String   "pwa" | "local-harness" | "other"
//   wrapped_dek  String    base64url-encoded AES-wrapped DEK (see §5)
//   blob_size    Number    padded ciphertext byte length (see §5.5)
//   surface      String    "memory" | "breadcrumb" | "feedback-draft" | "outfit" | ...
//   topic        String?   optional topic tag for compaction and <<FORGET>> resolution
//   visibility   String    "private" | "sponsor-visible"
//   supersedes   String?   _id of the memory this document supersedes (if any)
//   superseded_at Date?    set when a later memory supersedes this one
//   forgotten_at  Date?    set when <<FORGET>> retires this memory
//   key_version  Number    KEK version at write time (for rotation staleness detection)
//
// Active memories: those where superseded_at and forgotten_at are both absent.
// Only active memories are loaded into Layer 4a.

import { Mongo } from 'meteor/mongo';

const UserMemories = new Mongo.Collection('UserMemories');

// Expose globally so other server files and Phase 2 modules can access without import.
globalThis.UserMemoriesCollection = UserMemories;

export { UserMemories };
