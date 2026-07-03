module.exports = function(api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind", unstable_transformProfile: "default" }],
      "nativewind/babel",
    ],
  };
};
