import { Accounts } from 'meteor/accounts-base';
import { Random } from 'meteor/random';

/**
 * Security: Deny all client-side updates to user documents
 * 
 * User documents contain sensitive data including hashed login tokens,
 * sponsorship info, and permissions. All modifications must go through
 * server-side Meteor methods with proper validation.
 */
Meteor.users.deny({
  update() { return true; }
});

/**
 * Login Token Enhancement System
 * 
 * When a user logs in (via resume token, OAuth, or session authorization),
 * we enhance the login token with additional metadata for security and tracking:
 * 
 * Token Structure (in user.services.resume.loginTokens[]):
 * - hashedToken: string - Hashed version of the token (Meteor default)
 * - when: Date - When token was created (Meteor default)
 * - _id: string - Unique identifier for this specific token instance
 * - sessionId: string - ApplicationSessions._id this token is bound to
 * - type: string - 'resume' | 'oauth' | 'session-authorization'
 * - asof: Date - Last time this token was used
 * - agent: string - User agent string from HTTP headers
 * - address: string - Client IP address
 * - memo: string - Optional human-readable description
 * - authorizedSession: string - For session-authorization type, the target session ID
 * 
 * Flow:
 * 1. User attempts login with resume token
 * 2. Meteor validates token and calls onLogin hook
 * 3. We find the matching token in the loginTokens array
 * 4. We enhance it with session binding and metadata
 * 5. We update the ApplicationSession with userId/username
 * 6. Both user and session counters are incremented
 * 
 * Note: Tokens created via authorize.session already have metadata
 * (see methods.js lines 283-286). This hook ensures ALL tokens get
 * enhanced, regardless of creation method.
 */
Accounts.onLogin(async (loginInfo) => {
  try {
    const { user, connection, type } = loginInfo;
    
    // Extract resume token from method arguments
    // loginInfo.methodArguments[0] is the login request object
    const resumeToken = loginInfo.methodArguments?.[0]?.resume;

    if (!resumeToken) {
      log.warning('[onLogin] No resume token in login attempt', { 
        userId: user?._id,
        type,
        connectionId: connection?.id 
      });
      return;
    }

    // Validate user structure
    if (!user?.services?.resume?.loginTokens) {
      log.error('[onLogin] User missing login tokens structure', {
        userId: user?._id,
        hasServices: !!user?.services,
        hasResume: !!user?.services?.resume
      });
      return;
    }

    const loginTokens = user.services.resume.loginTokens;
    const hashedUserToken = Accounts._hashLoginToken(resumeToken);

    // Find the matching token in the user's loginTokens array
    const tokenIndex = loginTokens.findIndex(
      (loginToken) => loginToken.hashedToken === hashedUserToken
    );

    // Critical: tokenIndex can be 0 (first token), so check === -1
    if (tokenIndex === -1) {
      log.error('[onLogin] No matching login token found in user document', {
        userId: user._id,
        username: user.username,
        tokenCount: loginTokens.length,
        connectionId: connection.id
      });
      return;
    }

    const matchingToken = loginTokens[tokenIndex];
    const now = new Date();

    // Find the session for this connection
    const session = await ApplicationSessions.findOneAsync(connection.id);
    
    if (!session) {
      log.error('[onLogin] Session not found for connection', {
        connectionId: connection.id,
        userId: user._id,
        username: user.username,
        type
      });
      return;
    }

    // Enhance the login token with metadata and session binding
    const setObj = {
      // Update user's last login timestamp
      'last.login': now,
      
      // Token metadata
      [`services.resume.loginTokens.${tokenIndex}._id`]: matchingToken._id || Random.id(),
      [`services.resume.loginTokens.${tokenIndex}.sessionId`]: session._id,
      [`services.resume.loginTokens.${tokenIndex}.type`]: type,
      [`services.resume.loginTokens.${tokenIndex}.asof`]: now,
      [`services.resume.loginTokens.${tokenIndex}.agent`]: connection.httpHeaders?.['user-agent'] || 'unknown',
      [`services.resume.loginTokens.${tokenIndex}.address`]: connection.clientAddress,
      [`services.resume.loginTokens.${tokenIndex}.memo`]: matchingToken.memo || ''
    };

    // If this is a session-authorization token, preserve the authorizedSession field
    if (matchingToken.authorizedSession) {
      setObj[`services.resume.loginTokens.${tokenIndex}.authorizedSession`] = matchingToken.authorizedSession;
    }

    // Update user document with enhanced token and increment login counter
    await Accounts.users.updateAsync(
      { _id: user._id },
      { 
        $set: setObj,
        $inc: { 'counters.login': 1 }
      }
    );

    // Update session with user identity if not already set
    const sessionUpdate = {
      $inc: { 'counters.login': 1 }
    };

    if (!session.userId) {
      sessionUpdate.$set = {
        userId: user._id,
        username: user.username,
        authenticatedAt: now
      };

      log.success(`[onLogin] User ${user.username} authenticated connection ${connection.id} with ${type} token`);
    } else {
      log.info(`[onLogin] User ${user.username} re-authenticated existing session ${connection.id}`);
    }

    await ApplicationSessions.updateAsync(
      connection.id,
      sessionUpdate
    );

  } catch (error) {
    log.error('[onLogin] Unexpected error during login enhancement', {
      error: error.message,
      stack: error.stack,
      userId: loginInfo.user?._id,
      connectionId: loginInfo.connection?.id,
      type: loginInfo.type
    });
  }
}); 
