const fs   = require('fs');
const path = require('path');

module.exports = async function read_file(params, context) {
  const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${context.entity}`);
  const target    = path.resolve(entityDir, params.path);

  if (!target.startsWith(entityDir + path.sep) && target !== entityDir) {
    throw new Error('path outside entity directory');
  }

  if (!fs.existsSync(target)) {
    return { error: 'file not found', path: params.path };
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return { error: 'path is a directory, use list_dir', path: params.path };
  }

  try {
    return fs.readFileSync(target, 'utf8');
  } catch (e) {
    return { error: e.message };
  }
};
