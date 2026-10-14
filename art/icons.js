'use strict';

// Item icons for menus: an item type's own art (art/items.js), drawn by the game's renderer in
// the current art style onto a small canvas and kept as an image URL.
// ItemIcons.url(kind, style, size) -> data URL of a size x size (CSS pixels) icon, sharp on
// high-DPI screens. Each kind/style/size is drawn once and reused.
// Items differ a lot in shape (a long ingot, a squat canister), so each is drawn once to find
// where its art actually lands, then again scaled and centred to fill the icon.
// Browser script (global `ItemIcons`).

const ItemIcons = (() => {
  const config = {
    angle: -0.35, // the same three-quarter turn the items float at in space
    fill: 0.9, // share of the icon the art's longer side spans
    maxZoom: 1.8, // a small item is enlarged at most this much over its radius-sized drawing
    texelPx: 2, // pixel style: CSS pixels per texel, about as chunky as items look in space
  };
  const cache = new Map();

  // Bounding box of the drawn (non-transparent) pixels, or null if nothing was drawn.
  function inked(ctx) {
    const { width: w, height: hgt } = ctx.canvas;
    const a = ctx.getImageData(0, 0, w, hgt).data;
    let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        if (a[(y * w + x) * 4 + 3] < 24) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }

  // Draw at k device pixels per world unit with the item's origin at (ox, oy). Pixel art gets
  // `texel` device pixels per texel, whatever the scale, so texels stay square and sharp.
  function draw(ctx, bp, style, k, ox, oy, texel) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(k, 0, 0, k, ox, oy);
    // t only matters for blinking lights; at 0.4 most are on.
    Art.drawAsset(ctx, bp, style, { angle: config.angle, t: 0.4, texel: texel / k });
  }

  function canvas(px, read) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    return cv.getContext('2d', read ? { willReadFrequently: true } : undefined);
  }

  function url(kind, style = 'line', size = 28) {
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const key = `${kind}|${style}|${size}|${dpr}`;
    if (cache.has(key)) return cache.get(key);
    const bp = ArtItems.create(kind, 1);
    const px = Math.round(size * dpr);
    const texel = Math.max(1, Math.round(config.texelPx * dpr));
    // First pass, on a canvas twice the size so nothing is cut off: the item's radius spans
    // the icon. That shows where the art really is.
    const k0 = ((px / 2) * 0.94) / bp.radius;
    const probe = canvas(px * 2, true);
    draw(probe, bp, style, k0, px, px, texel);
    const box = inked(probe);
    let k = k0, ox = px / 2, oy = px / 2;
    if (box) {
      // Then the art's longer side spans `fill` of the icon, centred.
      const [x0, y0, x1, y1] = box;
      k = k0 * Math.min((px * config.fill) / Math.max(x1 - x0, y1 - y0), config.maxZoom);
      const cx = ((x0 + x1) / 2 - px) / k0, cy = ((y0 + y1) / 2 - px) / k0; // art centre, world units
      ox = px / 2 - cx * k;
      oy = px / 2 - cy * k;
      if (style === 'pixel') { ox = Math.round(ox); oy = Math.round(oy); }
    }
    const ctx = canvas(px, false);
    draw(ctx, bp, style, k, ox, oy, texel);
    const u = ctx.canvas.toDataURL();
    cache.set(key, u);
    return u;
  }

  return { config, url };
})();
