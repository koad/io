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

  let body = params.content;

  if (params.attributed_to) {
    const date   = new Date().toISOString().slice(0, 10);
    const entity = context.entity || '';

    if (body.startsWith('---\n')) {
      // Caller supplied frontmatter — inject attributed_to + entity before the closing ---
      const closingIdx = body.indexOf('\n---\n', 4);
      if (closingIdx !== -1) {
        const before = body.slice(0, closingIdx);
        const after  = body.slice(closingIdx);
        body = `${before}\nattributed_to: ${params.attributed_to}\nentity: ${entity}\ndate: ${date}${after}`;
      } else {
        // Malformed frontmatter — prepend a fresh block instead
        body = `---\nattributed_to: ${params.attributed_to}\nentity: ${entity}\ndate: ${date}\n---\n\n${params.content}`;
      }
    } else {
      body = `---\nattributed_to: ${params.attributed_to}\nentity: ${entity}\ndate: ${date}\n---\n\n${params.content}`;
    }
  }

  try {
    fs.writeFileSync(target, body, 'utf8');
    return { ok: true, path: `briefs/${basename}` };
  } catch (e) {
    return { error: e.message };
  }
};
