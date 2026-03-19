/**
 * Client-Side Authentication Globals
 * 
 * Provides simplified authentication functions and manages automatic
 * login via the session dataport (consumable tokens).
 * 
 * Key Features:
 * - Simple Login/Logout functions
 * - Automatic consumable token handling
 * - Session dataport observation
 * - User status monitoring
 */

/**
 * Login with Token
 * 
 * Simplified login function using Meteor's token-based authentication.
 * This is the primary authentication method for koad:io apps.
 * 
 * @param {String} token - Login token (from QR code, invitation, etc)
 */
Login = function(token) {
	if (!token) {
		console.error('[Login] No token provided');
		return;
	}
	
	Meteor.loginWithToken(token, (error) => {
		if (error) {
			console.error('[Login] Authentication failed:', error.reason);
		} else {
			if (DEBUG) console.log('[Login] Successfully authenticated');
		}
	});
};

/**
 * Logout
 * 
 * Simple logout wrapper.
 */
Logout = function() {
	Meteor.logout((error) => {
		if (error) {
			console.error('[Logout] Error logging out:', error.reason);
		} else {
			if (DEBUG) console.log('[Logout] Successfully logged out');
		}
	});
};

/**
 * Manage User Authentication State
 * 
 * Handles automatic login when consumable tokens appear in the session dataport.
 * This enables QR code scanning and remote session authorization.
 * 
 * Flow:
 * 1. Server authorizes session (creates consumable)
 * 2. Session dataport updates with consumable reference
 * 3. This function detects the change
 * 4. Calls gather.consumable to get the token
 * 5. Logs in with the token
 * 
 * @param {String} id - Session ID
 * @param {Object} state - Changed fields in session document
 */
const manageUserAuthenticationState = (id, state) => {
	koad.internals.asof = new Date();
	
	if (!state) return;

	// Handle consumable token (QR code / session authorization)
	if (state.consumable) {
		if (DEBUG) console.log('[auth-state] Consumable token received:', state.consumable);

		Meteor.call('consume.authorization', state.consumable, (error, token) => {
			if (error) {
				console.error('[auth-state] Failed to consume token:', error.reason);
				return;
			}

			if (!token) {
				console.error('[auth-state] No token returned from consumable');
				return;
			}

			Meteor.loginWithToken(token, (error) => {
				if (error) {
					console.error('[auth-state] Login failed:', error.reason);
				} else {
					if (DEBUG) console.log('[auth-state] Successfully logged in via consumable');
				}
			});
		});
	}
	
	// Legacy direct token method (deprecated)
	else if (state.stampedLoginToken) {
		console.warn('[auth-state] DEPRECATED: Direct stampedLoginToken usage detected');
		console.warn('[auth-state] Please use consumable tokens instead');
		
		Meteor.loginWithToken(state.stampedLoginToken.token, (error) => {
			if (error) {
				console.error('[auth-state] Legacy login failed:', error.reason);
			} else {
				if (DEBUG) console.log('[auth-state] Logged in via legacy method');
			}
		});
	}
};

/**
 * Session Dataport Observer
 * 
 * Observes changes to the session document to detect authentication events.
 * Delays 1.6s to ensure subscription is ready.
 */
Meteor.setTimeout(() => {
	const sessionId = Meteor.connection._lastSessionId;
	
	if (!sessionId) {
		console.error('[dataport] No session ID found on connection');
		return;
	}

	Tracker.autorun(() => {
		const sessionData = ApplicationSessions.find({ _id: sessionId });
		
		if (!sessionData.count()) {
			return;
		}

		if (koad.internals.upstart) {
			return;
		}

		koad.internals.upstart = new Date();

		sessionData.observeChanges({
			added: function (id) {
				if (DEBUG) console.log(`[dataport] Attached to session [${id}], observing changes`);
			},
			
			changed: function (id, changedFields) {
				if (DEBUG) console.log(`[dataport] Session [${id}] updated:`, Object.keys(changedFields));
				manageUserAuthenticationState(id, changedFields);
			},
			
			removed: function (id) {
				console.warn(`[dataport] Session [${id}] removed - connection may have closed`);
			}
		});
	});
}, 1600);

/**
 * User Status Monitoring
 * 
 * If mizzao:user-status package is available, start monitoring user activity.
 * Tracks online/idle/offline status and last activity.
 * 
 * Configuration:
 * - threshold: 30s of inactivity = idle
 * - idleOnBlur: Tab blur = idle
 * - interval: Check every 1s
 */
if (Package['mizzao:user-status']) {
	Package['mizzao:user-status'].UserStatus.startMonitor({
		threshold: 30000,  // 30 seconds
		idleOnBlur: true,
		interval: 1000     // 1 second
	});
	
	if (DEBUG) console.log('[user-status] Activity monitoring enabled');
}

