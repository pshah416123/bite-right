module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: { '~': __dirname },
        },
      ],
      // 'react-native-reanimated/plugin', // disabled — using RN built-in Animated
    ],
  };
};
