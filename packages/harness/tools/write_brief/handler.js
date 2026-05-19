const fs   = require('fs');
const path = require('path');

module.exports = async function write_brief(params, context) {
  if (!params.filename || !params.filename.endsWith('.md')) {
    throw new Error('filename must end in .md');
  }

  // Strip any path components — filename only, no slashes
  const basename = path.basename(params.filename);
  if (basename !== params.filename) {
    throw new Error('filename must be a plain filename, no path separators');
  }

  const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${context.entity}`);
  const briefsDir = path.join(entityDir, 'briefs');
  const target    = path.join(briefsDir, basename);

  // Verify containment (defensive — basename already strips paths)
  if (!target.startsWith(briefsDir + path.sep)) {
    throw new Error('path outside briefs directory');
  }

  if (!fs.existsSync(briefsDir)) {
    fs.mkdirSync(briefsDir, { recursive: true });
  }

  try {
    fs.writeFileSync(target, params.content, 'utf8');
    return { ok: true, path: `briefs/${basename}` };
  } catch (e) {
    return { error: e.message };
  }
};
