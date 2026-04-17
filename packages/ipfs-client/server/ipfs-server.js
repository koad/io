/**
 * koad:io-ipfs-client — server/ipfs-server.js
 *
 * Server-side IPFS interface stub.
 *
 * STATUS: Phase 2 — pinning service implementation TBD.
 *
 * This file defines the API shape for the daemon-side IPFS pinning service
 * so server code can reference the interface without crashing. The actual
 * implementation (full Helia node, pin management, sponsor-tier gating) is
 * a Phase 2 build.
 *
 * Phase 2 implementation notes (for when this gets built):
 *   - Runtime: full Helia node (not @helia/http — server has no browser constraint)
 *   - Storage: blockstore-fs or blockstore-level (filesystem, not OPFS)
 *   - DHT: enabled — server node IS a DHT participant
 *   - Pinning tiers:
 *       All namespaced users: avatar + sigchain CID (essentials)
 *       Architect sponsors ($100+/mo): all content, full persistence
 *   - Architect: VESTA-SPEC-109 (Witness Protocol) alignment
 *   - Gating: GitHub Sponsors API lookup (live query, not stored tier)
 *   - Brief: ~/.juno/briefs/sigchain-witness-architecture.md
 *
 * Current behavior: all methods log a warning and return null/false.
 */

const IPFSServer = {

  /**
   * pin(cid, userId) — pin a CID for a user.
   * Phase 2: checks sponsor tier, pins if eligible, records in pin ledger.
   *
   * @param {string} cid
   * @param {string} userId
   * @returns {Promise<{ pinned: boolean, reason: string }>}
   */
  async pin(cid, userId) {
    console.warn('[koad:io-ipfs-server] pin() called but pinning service is not yet implemented (Phase 2). CID:', cid, 'userId:', userId);
    return { pinned: false, reason: 'Phase 2 not implemented' };
  },

  /**
   * unpin(cid, userId) — remove a pin for a user.
   * Phase 2: removes from pin ledger, schedules GC if no other holders.
   *
   * @param {string} cid
   * @param {string} userId
   * @returns {Promise<{ unpinned: boolean, reason: string }>}
   */
  async unpin(cid, userId) {
    console.warn('[koad:io-ipfs-server] unpin() called but pinning service is not yet implemented (Phase 2).');
    return { unpinned: false, reason: 'Phase 2 not implemented' };
  },

  /**
   * has(cid) — check if a CID is pinned on the server node.
   *
   * @param {string} cid
   * @returns {Promise<boolean>}
   */
  async has(cid) {
    console.warn('[koad:io-ipfs-server] has() called but pinning service is not yet implemented (Phase 2).');
    return false;
  },

  /**
   * status() — return the server node status.
   * Phase 2: returns node peer ID, connected peers, stored block count.
   *
   * @returns {Promise<{ running: boolean, peerId: string|null, peers: number }>}
   */
  async status() {
    return {
      running: false,
      peerId: null,
      peers: 0,
      phase: 2,
      note: 'Server IPFS node not yet implemented. See server/ipfs-server.js for Phase 2 spec.'
    };
  },

  /**
   * pinnedCIDs(userId) — list all CIDs pinned for a user.
   * Phase 2: queries pin ledger filtered by userId.
   *
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async pinnedCIDs(userId) {
    console.warn('[koad:io-ipfs-server] pinnedCIDs() called but pinning service is not yet implemented (Phase 2).');
    return [];
  }

};

// Attach to koad global (server-side koad object from koad:io-core)
if (typeof koad !== 'undefined') {
  koad.ipfs = koad.ipfs || {};
  koad.ipfs.server = IPFSServer;
}
