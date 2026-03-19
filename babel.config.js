module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['expo'],
    plugins: [
      'expo-router/babel',
      [
        'module-resolver',
        {
          alias: { '~': '.' },
          // Do not use root: ['.'] so bare 'server' never resolves to ./server (Node-only code).
        },
      ],
    ],
  };
};
