/**
 * Invitation System (DEPRECATED)
 *
 * The login-token-based invitation flow has been superseded by
 * VESTA-SPEC-189 (koad:io-invitations package), which uses consumable
 * CIDs instead of raw session tokens in URLs.
 *
 * This file retains only the ApplicationInvitations collection declaration
 * so that existing records remain queryable during migration. No new
 * invitations should be created through this path — use
 * koad.invitation.issue (SPEC-189) instead.
 */
ApplicationInvitations = new Mongo.Collection('invitations');
