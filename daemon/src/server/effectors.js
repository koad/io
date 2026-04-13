// End-effector actions — operator-triggered via DDP from passenger widgets
// No auth — inside the hard shell (localhost only)

const { exec } = Npm.require('child_process');

Meteor.methods({

  /**
   * Launch an entity's default harness session in a detached screen.
   * If the screen already exists, report it instead of double-launching.
   */
  'harness.launch'(entityHandle) {
    check(entityHandle, String);

    const screenName = `harness-${entityHandle}`;

    // Check if a screen with this name is already running
    try {
      const existing = Npm.require('child_process').execSync(
        `screen -list | grep '${screenName}'`,
        { encoding: 'utf8' }
      );
      if (existing && existing.trim().length > 0) {
        console.log(`[EFFECTOR] harness.launch: ${entityHandle} already running (${screenName})`);
        return { running: true, screen: screenName };
      }
    } catch (e) {
      // grep returns exit 1 when no match — that means no existing screen, which is fine
    }

    // Launch in a new detached screen session
    const cmd = `screen -dmS ${screenName} ${entityHandle} harness default`;
    console.log(`[EFFECTOR] harness.launch: ${cmd}`);

    try {
      Npm.require('child_process').execSync(cmd, { encoding: 'utf8' });
    } catch (e) {
      console.error(`[EFFECTOR] harness.launch failed: ${e.message}`);
      throw new Meteor.Error('launch-failed', e.message);
    }

    console.log(`[EFFECTOR] harness.launch: ${entityHandle} started in screen ${screenName}`);
    return { launched: true, screen: screenName };
  },

  /**
   * Open a URL with the system default application (xdg-open on Linux).
   */
  'open.with.default.app'(targetUrl) {
    check(targetUrl, String);
    console.log(`[EFFECTOR] open.with.default.app: ${targetUrl}`);
    exec(`xdg-open "${targetUrl}"`);
  },

  /**
   * Open a Chrome PWA by app ID.
   */
  'open.pwa'(appId) {
    check(appId, String);
    console.log(`[EFFECTOR] open.pwa: ${appId}`);
    exec(`google-chrome --profile-directory=Default --app-id=${appId}`);
  },

  /**
   * Open a Brave PWA by app ID.
   */
  'open.pwa.with.brave'(appId) {
    check(appId, String);
    console.log(`[EFFECTOR] open.pwa.with.brave: ${appId}`);
    exec(`brave-browser --profile-directory=Default --app-id=${appId}`);
  },

  /**
   * Open a URL in Chrome.
   */
  'open.with.chrome'(url) {
    check(url, String);
    console.log(`[EFFECTOR] open.with.chrome: ${url}`);
    exec(`google-chrome --profile-directory=Default "${url}"`);
  },

  /**
   * Open a URL in Brave.
   */
  'open.with.brave'(url) {
    check(url, String);
    console.log(`[EFFECTOR] open.with.brave: ${url}`);
    exec(`brave-browser --profile-directory=Default "${url}"`);
  },

});
