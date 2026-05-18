#!/usr/bin/env node
/**
 * Patches expo-linking to not crash in Expo Go dev mode when
 * collectManifestSchemes() returns []. Returns 'biteright' instead of throwing.
 * Run automatically via postinstall.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-linking',
  'build',
  'Schemes.js'
);

if (!fs.existsSync(file)) {
  console.log('expo-linking not installed yet, skipping patch');
  process.exit(0);
}

let src = fs.readFileSync(file, 'utf8');

// Already patched?
if (src.includes('BiteRight patch')) {
  console.log('expo-linking already patched');
  process.exit(0);
}

// Patch 1: line ~96 – don't throw when no schemes and not StoreClient
src = src.replace(
  `else if (!__DEV__ || Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {\n            // Throw in production or when not in store client. Use the __DEV__ flag so users can test this functionality with \`expo start --no-dev\`,\n            throw new Error('Cannot make a deep link into a standalone app with no custom scheme defined');`,
  `else if (!__DEV__ || Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {\n            // BiteRight patch: warn instead of crash in dev\n            if (__DEV__) {\n                console.warn('expo-linking: no custom scheme found, using "biteright" fallback');\n            } else {\n                throw new Error('Cannot make a deep link into a standalone app with no custom scheme defined');\n            }`
);

// Patch 2: line ~146 – return 'biteright' in dev instead of throwing
src = src.replace(
  `if (!scheme) {\n        const errorMessage = \`Linking requires a build-time setting \\\`scheme\\\` in the project's Expo config (app.config.js or app.json) for bare or production apps. Manually providing a \\\`scheme\\\` property can circumvent this error. Learn more: \${LINKING_GUIDE_URL}\`;\n        // Throw in production, use the __DEV__ flag so users can test this functionality with \`expo start --no-dev\`\n        throw new Error(errorMessage);`,
  `if (!scheme) {\n        // BiteRight patch: return app scheme instead of crashing in Expo Go dev mode\n        if (__DEV__) {\n            return 'biteright';\n        }\n        const errorMessage = \`Linking requires a build-time setting \\\`scheme\\\` in the project's Expo config (app.config.js or app.json) for bare or production apps. Manually providing a \\\`scheme\\\` property can circumvent this error. Learn more: \${LINKING_GUIDE_URL}\`;\n        // Throw in production, use the __DEV__ flag so users can test this functionality with \`expo start --no-dev\`\n        throw new Error(errorMessage);`
);

fs.writeFileSync(file, src);
console.log('expo-linking patched successfully');
