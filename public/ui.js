"use strict";

// Pure presentation helpers, shared by the browser and the Node tests.
(function (root, factory) {
  const helpers = factory();
  if (typeof module === "object" && module.exports) module.exports = helpers;
  else root.DownstackUI = helpers;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const RARITY = [
    "Common answer",
    "Uncommon answer",
    "Distinctive answer",
    "Rare answer",
    "Very rare answer",
    "Legendary answer",
  ];
  const FLAVOR = [
    "It ships. So did everyone else’s.",
    "There’s something here.",
    "Quietly doing something clever.",
    "Now you’re onto something.",
    "A billion-dollar deep cut.",
    "They’ll tell this story for years.",
  ];

  function depthPercent(depth, layers) {
    const floor = layers.at(-1)?.from || 7000;
    return Math.max(0, Math.min(100, (Number(depth) / floor) * 100));
  }

  function currentLayer(depth, layers) {
    return layers.reduce(
      (current, layer, index) => (depth >= layer.from ? index : current),
      0,
    );
  }

  function secondsLeft(ms) {
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function rankDescription(tier) {
    return RARITY[tier - 1] || "No match";
  }

  function rankFlavor(tier) {
    return FLAVOR[tier - 1] || "The next prompt is a fresh start.";
  }

  return {
    depthPercent,
    currentLayer,
    secondsLeft,
    rankDescription,
    rankFlavor,
  };
});
