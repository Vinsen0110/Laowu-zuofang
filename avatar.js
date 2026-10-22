// Default avatars: a soft "marble" picture worked out from the account email,
// so everyone gets their own and it never changes. Users can upload their own
// (stored as user.avatar); lwAvatarUrl prefers that.
(function () {
  "use strict";

  const PALETTES = [
    ["#ffd6a5", "#ff9b85", "#e66a8a", "#6f5cc2"],
    ["#a8e6cf", "#56c596", "#329d9c", "#205072"],
    ["#fde2e4", "#fad2e1", "#bee1e6", "#7fb7be"],
    ["#ffe29a", "#ffa552", "#e85d75", "#5a3d8c"],
    ["#cdeac0", "#9ad1d4", "#5aa9e6", "#3d5a80"],
    ["#f9c6c9", "#c3aed6", "#8ec5fc", "#4f6d9a"],
    ["#fff1c1", "#b8e0d2", "#6fb1a0", "#2f6f73"],
    ["#ffcad4", "#f4acb7", "#9d8189", "#5c4d7d"],
    ["#e0f2fe", "#93c5fd", "#6366f1", "#312e81"],
    ["#fef3c7", "#fcd34d", "#f97316", "#9a3412"],
  ];

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Small seeded generator so every shape comes from the same seed.
  function rng(seed) {
    let s = seed || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  const cache = new Map();

  function lwAvatar(seed) {
    const key = String(seed || "?").toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const h = hash(key);
    const r = rng(h);
    const palette = PALETTES[h % PALETTES.length];
    const order = palette.slice().sort(() => r() - 0.5);
    const blob = (color, i) => {
      const cx = Math.round(10 + r() * 60), cy = Math.round(10 + r() * 60);
      const rx = Math.round(26 + r() * 22), ry = Math.round(18 + r() * 20);
      const rot = Math.round(r() * 180);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" transform="rotate(${rot} ${cx} ${cy})" opacity="${i ? 0.9 : 1}"/>`;
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter><clipPath id="c"><circle cx="40" cy="40" r="40"/></clipPath></defs><g clip-path="url(#c)"><rect width="80" height="80" fill="${order[0]}"/><g filter="url(#b)">${order.slice(1).map(blob).join("")}</g></g></svg>`;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    cache.set(key, url);
    return url;
  }

  function lwAvatarUrl(user) {
    if (!user) return lwAvatar("?");
    return user.avatar || lwAvatar(user.email || user.username || user.id);
  }

  globalThis.lwAvatar = lwAvatar;
  globalThis.lwAvatarUrl = lwAvatarUrl;
})();
