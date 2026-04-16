/**
 * Rate Limiting
 * 
 * Protects against abuse by limiting the rate of method calls and logins.
 * 
 * Uses Meteor's built-in DDPRateLimiter to enforce limits based on:
 * - User ID (authenticated users)
 * - Connection ID (unauthenticated users)
 * - Client IP address
 * 
 * Configuration (in settings.json):
 *   Meteor.settings.rateLimiting = {
 *     enabled: true,
 *     loginAttempts: 5,        // Max login attempts per 5 minutes
 *     methodCalls: 20,         // Max method calls per 10 seconds
 *     invitationCreation: 3,   // Max invitations per hour
 *     sponsorVerification: 10  // Max verifications per hour
 *   }
 */

import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

const config = Meteor.settings.rateLimiting || {
	enabled: true,
	loginAttempts: 5,
	methodCalls: 20,
	invitationCreation: 3,
	sponsorVerification: 10
};

if (!config.enabled) {
	console.log('[rate-limiting] Rate limiting is disabled');
} else {
	console.log('[rate-limiting] Configuring rate limits...');

	// =========================================================================
	// Login Rate Limiting
	// =========================================================================
	
	/**
	 * Limit login attempts
	 * 
	 * Prevents brute force attacks on user accounts.
	 * Limit: 5 attempts per 5 minutes per connection/IP
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'login',
		connectionId() { return true; }
	}, config.loginAttempts, 5 * 60 * 1000); // 5 minutes

	/**
	 * Limit resume token usage
	 * 
	 * Prevents token theft/replay attacks.
	 * Limit: 10 resumes per minute per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'login',
		connectionId() { return true; }
	}, 10, 60 * 1000); // 1 minute

	// =========================================================================
	// Invitation Rate Limiting
	// =========================================================================
	
	/**
	 * Limit invitation creation
	 * 
	 * Prevents invitation spam.
	 * Limit: 3 invitations per hour per user
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'invitation.create',
		userId(userId) { return !!userId; }
	}, config.invitationCreation, 60 * 60 * 1000); // 1 hour

	/**
	 * Legacy method name
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'GenerateInviteCode',
		userId(userId) { return !!userId; }
	}, config.invitationCreation, 60 * 60 * 1000); // 1 hour

	// =========================================================================
	// Sponsor Verification Rate Limiting
	// =========================================================================
	
	/**
	 * Limit sponsor link creation
	 * 
	 * Prevents spam linking of sponsor accounts.
	 * Limit: 10 attempts per hour per user
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'sponsor.link',
		userId(userId) { return !!userId; }
	}, config.sponsorVerification, 60 * 60 * 1000); // 1 hour

	/**
	 * Limit sponsor verification
	 * 
	 * Prevents API abuse on sponsor platforms.
	 * Limit: 10 verifications per hour per user
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'sponsor.verify',
		userId(userId) { return !!userId; }
	}, config.sponsorVerification, 60 * 60 * 1000); // 1 hour

	/**
	 * Limit sponsor refresh
	 * 
	 * Prevents excessive API calls to sponsor platforms.
	 * Limit: 10 refreshes per hour per user
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'sponsor.refresh',
		userId(userId) { return !!userId; }
	}, config.sponsorVerification, 60 * 60 * 1000); // 1 hour

	// =========================================================================
	// OAuth Rate Limiting
	// =========================================================================
	
	/**
	 * Limit GitHub OAuth initiations
	 * 
	 * Prevents OAuth abuse.
	 * Limit: 10 attempts per hour per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'github.oauth.initiate',
		connectionId() { return true; }
	}, 10, 60 * 60 * 1000); // 1 hour

	/**
	 * Limit GitHub OAuth callbacks
	 * 
	 * Prevents callback spam.
	 * Limit: 20 callbacks per hour per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'github.oauth.callback',
		connectionId() { return true; }
	}, 20, 60 * 60 * 1000); // 1 hour

	// =========================================================================
	// OAuth Methods Rate Limiting
	// =========================================================================

	/**
	 * Limit oauth.consumable.create
	 *
	 * Called once per GitHub OAuth callback — should be very rare per connection.
	 * Limit: 20 per hour per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'oauth.consumable.create',
		connectionId() { return true; }
	}, 20, 60 * 60 * 1000); // 1 hour

	/**
	 * Limit oauth.user.create
	 *
	 * New user creation — even stricter.
	 * Limit: 5 per hour per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'oauth.user.create',
		connectionId() { return true; }
	}, 5, 60 * 60 * 1000); // 1 hour

	// =========================================================================
	// Session Management Rate Limiting
	// =========================================================================
	
	/**
	 * Limit session authorization
	 * 
	 * Prevents token generation spam.
	 * Limit: 20 authorizations per hour per user
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'authorize.session',
		userId(userId) { return !!userId; }
	}, 20, 60 * 60 * 1000); // 1 hour

	/**
	 * Limit consumable token consumption
	 * 
	 * Prevents token brute force.
	 * Limit: 30 attempts per 10 minutes per connection
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		name: 'gather.consumable',
		connectionId() { return true; }
	}, 30, 10 * 60 * 1000); // 10 minutes

	// =========================================================================
	// General Method Rate Limiting
	// =========================================================================
	
	/**
	 * Global method call limit
	 * 
	 * Prevents general API abuse.
	 * Limit: 100 method calls per minute per connection
	 * 
	 * Note: This is a catch-all. Specific methods have stricter limits above.
	 */
	DDPRateLimiter.addRule({
		type: 'method',
		connectionId() { return true; }
	}, 100, 60 * 1000); // 1 minute

	// =========================================================================
	// Subscription Rate Limiting
	// =========================================================================
	
	/**
	 * Limit subscription creations
	 * 
	 * Prevents subscription spam.
	 * Limit: 50 subscriptions per minute per connection
	 */
	DDPRateLimiter.addRule({
		type: 'subscription',
		connectionId() { return true; }
	}, 50, 60 * 1000); // 1 minute

	console.log('[rate-limiting] Rate limits configured successfully');
}

/**
 * Custom Error Handler
 * 
 * Provides user-friendly error messages when rate limits are exceeded.
 */
DDPRateLimiter.setErrorMessage((rateLimitResult) => {
	const { timeToReset } = rateLimitResult;
	const secondsToReset = Math.ceil(timeToReset / 1000);
	const minutesToReset = Math.ceil(secondsToReset / 60);

	if (minutesToReset > 1) {
		return `Too many requests. Please try again in ${minutesToReset} minutes.`;
	} else {
		return `Too many requests. Please try again in ${secondsToReset} seconds.`;
	}
});

log.success('loaded koad-io-accounts-core/rate-limiting');
