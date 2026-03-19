const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const projectRoot = __dirname;
const serverDir = path.join(projectRoot, 'server') + path.sep;

function isUnderServer(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = path.normalize(filePath) + path.sep;
  return normalized === serverDir || normalized.startsWith(serverDir);
}

// Never bundle the Node server (uses require('crypto') etc.). App talks to it over HTTP only.
config.resolver.blockList = [
  /[\/\\]server[\/\\]/,
  /^server[\/\\]/,
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Refuse to resolve into our server directory (Node-only code).
  if (moduleName === 'server' || (typeof moduleName === 'string' && (moduleName.startsWith('server/') || moduleName.startsWith('./server') || moduleName.startsWith('../server')))) {
    return { type: 'empty' };
  }
  const resolve = defaultResolveRequest || context.resolveRequest;
  const result = resolve(context, moduleName, platform);
  if (result && result.filePath && isUnderServer(result.filePath)) {
    return { type: 'empty' };
  }
  return result;
};

module.exports = config;
