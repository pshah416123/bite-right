const appJson = require('./app.json');

// Variant build support — lets us ship a parallel TestFlight app (e.g.
// "ByteRite Beta") alongside the production one so testers can install
// both side-by-side on the same phone. Selected via APP_VARIANT env var
// set per EAS build profile (see eas.json). Variants swap bundle ID,
// display name, and (optionally) the API URL so each variant can point
// at its own server. Production behavior is unchanged when APP_VARIANT
// is unset.
const VARIANTS = {
  beta: {
    nameSuffix: ' Beta',
    bundleSuffix: '.beta',
    schemeSuffix: 'beta',
  },
};

module.exports = () => {
  const variantKey = process.env.APP_VARIANT;
  const variant = variantKey ? VARIANTS[variantKey] : null;

  const base = appJson.expo;
  const name = variant ? `${base.name}${variant.nameSuffix}` : base.name;
  const scheme = variant ? `${base.scheme}${variant.schemeSuffix}` : base.scheme;
  const bundleIdentifier = variant
    ? `${base.ios.bundleIdentifier}${variant.bundleSuffix}`
    : base.ios.bundleIdentifier;
  const androidPackage = variant
    ? `${base.android.package}${variant.bundleSuffix}`
    : base.android.package;

  return {
    expo: {
      ...base,
      name,
      scheme,
      ios: {
        ...base.ios,
        bundleIdentifier,
      },
      android: {
        ...base.android,
        package: androidPackage,
      },
      extra: {
        ...base.extra,
        apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000',
        appVariant: variantKey || null,
      },
    },
  };
};
