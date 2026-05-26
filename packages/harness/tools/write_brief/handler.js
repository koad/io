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
  const visitorDir = path.join(entityDir, 'visitor');
  const target = path.join(visitorDir, basename);

  // Verify containment (defensive — basename already strips paths)
  if (!target.startsWith(visitorDir + path.sep)) {
    throw new Error('path outside visitor directory');
  }

  if (!fs.existsSync(visitorDir)) {
    fs.mkdirSync(visitorDir, { recursive: true });
  }

  // Server-side timestamp — visitors can't backdate
  const date = new Date().toISOString().slice(0, 10);
  const entity = context.entity || '';
  const caller = context.callerEntity || null;

  // Build the authenticated-vs-anonymous frontmatter
  const fm = [
    `date: ${date}`,
    `entity: ${entity}`,
    `source: storefront`,
  ];

  if (caller && caller.handle) {
    fm.push(`authenticated: true`);
    fm.push(`handle: ${caller.handle}`);
    if (caller.fingerprint) fm.push(`key_fingerprint: ${caller.fingerprint}`);
    if (caller.bondType) fm.push(`bond_status: ${caller.bondType}`);
  } else {
    fm.push(`authenticated: false`);
    if (params.attributed_to) fm.push(`attributed_to: ${params.attributed_to}`);
  }

  let body = params.content;

  if (body.startsWith('---\n')) {
    // Caller supplied frontmatter — inject our trusted fields before the closing ---
    const closingIdx = body.indexOf('\n---\n', 4);
    if (closingIdx !== -1) {
      const before = body.slice(0, closingIdx);
      const after  = body.slice(closingIdx);
      body = `${before}\n${fm.join('\n')}${after}`;
    } else {
      body = `---\n${fm.join('\n')}\n---\n\n${params.content}`;
    }
  } else {
    body = `---\n${fm.join('\n')}\n---\n\n${params.content}`;
  }

  try {
    fs.writeFileSync(target, body, 'utf8');
    return { ok: true, path: `visitor/${basename}`, authenticated: !!(caller && caller.handle) };
  } catch (e) {
    return { error: e.message };
  }
};
