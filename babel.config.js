module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['expo'],
    plugins: ['expo-router/babel'],
  };
};
