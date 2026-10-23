// Line icons for the UI, drawn like the map and settings buttons' (index.html): a 24 × 24 grid,
// strokes 1.6 wide in the current text colour, round joins and caps, no fills. Kit.icon
// (ui/kit.js) draws one wherever an icon slot's code (or name) has a glyph, so a placeholder code
// ('WPN', 'TRD', ...) becomes its icon by being listed here.
//
//   Glyphs.has(name)          whether there is a glyph for that code or name
//   Glyphs.svg(name, size)    its <svg> markup, sized in px (aria-hidden: the label says it)
// ES module (`Glyphs`); also runs in Node (the tests).

const Glyphs = (() => {
  const SHIELD = 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z';
  const CRATE = 'M4 7.5l8-4 8 4v9l-8 4-8-4z';
  const HEX = 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z';
  const CROSSHAIR = '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>';
  const CLOUD = 'M7 18.5h10a3.8 3.8 0 0 0 .6-7.5 5.2 5.2 0 0 0-10-1.2A4.4 4.4 0 0 0 7 18.5z';
  const ICONS = {
    // The station's tabs.
    TRD: '<path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5"/>',
    SHP: '<path d="M12 2.5l6.5 16-6.5-3.5-6.5 3.5z"/><path d="M12 15v6"/>',
    RSC: '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(-60 12 12)"/>',
    IND: '<path d="M3 20.5V11l5 3v-3l5 3V5h5v15.5z"/><path d="M2 20.5h20M15.5 8.5h0"/>',
    SQD: '<path d="M12 3l3.5 7-3.5-1.8L8.5 10zM6 12.5l3.5 7L6 17.7l-3.5 1.8zM18 12.5l3.5 7-3.5-1.8-3.5 1.8z"/>',
    MSN: '<path d="M5.5 21V3.5"/><path d="M5.5 4h12l-2.5 4 2.5 4h-12"/>',
    // Ship slots and what they do.
    WPN: CROSSHAIR,
    SHD: `<path d="${SHIELD}"/>`,
    CPU: '<path d="M7 7h10v10H7z"/><path d="M10 10h4v4h-4zM10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
    ENG: '<path d="M12 2.5c3.5 4 5.5 7 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2 .8-3.6 2-5 .2 2 1 3.2 2.5 3.6C10.5 8 10.5 5.5 12 2.5z"/>',
    SCN: '<path d="M12 12l6-6"/><path d="M4.9 19.1a10 10 0 1 1 14.2 0"/><path d="M8.5 15.5a5 5 0 1 1 7 0"/>',
    SPD: '<path d="M4.5 6l6 6-6 6M12 6l6 6-6 6"/>',
    TRN: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4.5H15"/>',
    EVA: '<path d="M4 20c7 0 4-14 11-14h5"/><path d="M17 3l3 3-3 3"/><path d="M3 9h4M3 13h3"/>',
    DPS: '<circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.3 5.3l3 3M15.7 15.7l3 3M5.3 18.7l3-3M15.7 8.3l3-3"/>',
    AIM: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    SNS: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    MIN: '<path d="M4 20.5l9.5-9.5"/><path d="M8.5 5.5c4.2-2.6 9-1.6 11 3.5-3.8-1.6-7.4-1-9.5 1.2z"/>',
    CRG: `<path d="${CRATE}"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>`,
    HUL: '<path d="M4 5.5h16v13H4z"/><path d="M4 12h16M10 5.5V12M15 12v6.5M7 12v6.5"/>',
    FUL: '<path d="M12 3.5c3.2 4.2 5.5 7.2 5.5 10.2a5.5 5.5 0 0 1-11 0c0-3 2.3-6 5.5-10.2z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>', // fuel
    RNG: '<path d="M3 12h18M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5"/>',
    ARC: '<path d="M12 20L4.6 9.6a11 11 0 0 1 14.8 0z"/><circle cx="12" cy="20" r=".6"/>',
    STR: `<path d="${SHIELD}"/><path d="M12 9v6M9 12h6"/>`,
    RCH: '<path d="M13.5 2.5L6 13.5h5.5l-1 8 7.5-11h-5.5z"/>',
    LCK: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.2"/>',
    ACC: '<path d="M12.5 6l7 6-7 6z"/><path d="M3 12h6.5M5 8h4M5 16h4"/>',
    IDN: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2L21 21"/>',
    PNG: '<circle cx="12" cy="12" r="1.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    HND: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5v6.3M4.6 15.5l5.3-2.3M19.4 15.5l-5.3-2.3"/>',
    // Research and industry.
    MEM: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h1.5M4 12h1.5M4 18h1.5"/>',
    BLU: '<path d="M6 2.5h9l4 4v15H6z"/><path d="M15 2.5v4h4M9 12h7M9 16h7"/>',
    QUE: '<path d="M7 3h10M7 21h10"/><path d="M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
    BAY: '<path d="M8 4.5h8v8H8z"/><path d="M3 16h18M3 20h18M6 16v4M12 16v4M18 16v4"/>',
    WHS: '<path d="M3 10l9-6 9 6v10.5H3z"/><path d="M7 20.5v-7h10v7M7 17h10"/>',
    PKG: `<path d="${CRATE}"/><path d="M8.5 12l2.5 2.5 4.5-5"/>`,
    RCP: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3.5"/>',
    LAB: '<path d="M9 3v6.5L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L15 9.5V3"/><path d="M7.5 3h9M7 15h10"/>',
    // The processes (rules/recipes.js BAYS): a rock, a drop, arrows round, a hex nut, two blocks, a hull.
    ORE: '<path d="M4 15l3-8 6-3 6 5 1 7-6 4.5-7-1z"/><path d="M7 7l4 5 2-8M11 12l3 8.5M11 12l-7 3"/>',
    VOL: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    RCY: '<path d="M19.5 9.5A8 8 0 0 0 5 7.5M4.5 14.5a8 8 0 0 0 14.5 2"/><path d="M5 3.5v4h4M19 20.5v-4h-4"/>',
    FAB: `<path d="${HEX}"/><circle cx="12" cy="12" r="3.2"/>`,
    BEN: '<path d="M4 4h9v9H4z"/><path d="M11 11h9v9h-9z"/>',
    SHY: '<path d="M3 13.5h18l-3 6H6z"/><path d="M8 13.5V8h8v5.5M12 8V3.5"/>',
    MOD: '<path d="M9 2.5v4.5M15 2.5v4.5"/><path d="M6 7h12v5a6 6 0 0 1-12 0z"/><path d="M12 18v3.5"/>',
    SYS: '<path d="M3.5 5h17v14h-17z"/><path d="M7 10l3 2-3 2M12.5 15H17"/>',
    CMB: '<path d="M20.5 3.5c-5 0-9 2.5-12 7.5l4.5 4.5c5-3 7.5-7 7.5-12z"/><path d="M8.5 11L5 10.5 3.5 12l4 1M13 15.5l.5 3.5-1.5 1.5-1-4M8 16l-3.5 3.5"/>',
    TAC: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h4.5a3 3 0 0 0 0-6h-1a3 3 0 0 1 0-6H16"/>',
    MNT: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5l2.5-2.5a4 4 0 0 1 3 3L17.5 9.5"/><path d="M5 19l-1.5 1.5"/>',
    // Cargo, people, missions.
    HLD: '<path d="M3 8.5h18v12H3z"/><path d="M3 8.5l2-4.5h14l2 4.5M9 12.5h6"/>',
    FACE: '<circle cx="12" cy="8.5" r="4"/><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
    AND: '<path d="M5.5 8h13v10h-13z"/><path d="M12 4.5V8M9 12h.5M14.5 12h.5M9.5 15h5M3 11.5v3M21 11.5v3"/><circle cx="12" cy="3.5" r="1"/>',
    LGC: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/>',
    PRV: '<path d="M4 10.5h16v10H4z"/><path d="M12 2.5v9M8.5 8L12 11.5 15.5 8"/>',
    RWD: '<path d="M12 3l7.5 9-7.5 9-7.5-9z"/><path d="M4.5 12h15"/>',
    // Abilities (rules/abilities.js).
    REP: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
    SHC: `<path d="${SHIELD}"/><path d="M13 7.5L10.5 12h3L11 16.5"/>`,
    EMP: '<path d="M13.5 2.5L6 13.5h5.5l-1 8 7.5-11h-5.5z"/><path d="M3 6.5a10 10 0 0 0 0 11M21 6.5a10 10 0 0 1 0 11"/>',
    JAM: '<path d="M3 12c1.5-3.5 3-3.5 4.5 0s3 3.5 4.5 0 3-3.5 4.5 0 3 3.5 4.5 0"/><path d="M5 20L19 4"/>',
    // Field consumables (rules/abilities.js FIELD): a snowflake, a trefoil crossed out, a jerrycan, a
    // charge going off.
    CLF: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
    PRG: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2L9.2 5.4a7 7 0 0 1 5.6 0zM13.6 12.9l5.5.1a7 7 0 0 1-2.8 4.9zM10.4 12.9l-2.7 4.8a7 7 0 0 1-2.8-4.9z"/><path d="M4 4l16 16"/>',
    CAN: '<path d="M6 6.5h9l3 3v11H6z"/><path d="M8.5 6.5V4h4v2.5M9 12l5.5 5.5M14.5 12L9 17.5"/>',
    SEI: '<path d="M12 4.5v3M6.7 6.7l2.1 2.1M17.3 6.7l-2.1 2.1M4.5 12h3M16.5 12h3"/><path d="M3 20.5l4-5 3 2.5 3-5 3 4 2-2 3 5.5z"/>',
    // Utility gear: a box on a rail; a radiator's fins; a trefoil (radiation shielding).
    UTL: '<path d="M6 7.5h12v9H6z"/><path d="M3 12h3M18 12h3M9 7.5v9M15 7.5v9"/>',
    COL: '<path d="M4 4.5v15M20 4.5v15M4 12h16"/><path d="M8 7.5v9M12 7.5v9M16 7.5v9"/>',
    RAD: '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2L9.2 5.4a7 7 0 0 1 5.6 0zM13.6 12.9l5.5.1a7 7 0 0 1-2.8 4.9zM10.4 12.9l-2.7 4.8a7 7 0 0 1-2.8-4.9z"/>',
    '+': '<path d="M12 6v12M6 12h12"/>',
    // The context menu's actions in space (game/selection.js).
    dock: '<path d="M12 3v10M8 9.5l4 4 4-4"/><path d="M4 14.5V20h16v-5.5"/>',
    mine: '<path d="M4 20.5l9.5-9.5"/><path d="M8.5 5.5c4.2-2.6 9-1.6 11 3.5-3.8-1.6-7.4-1-9.5 1.2z"/>',
    collect: `<path d="${CLOUD}"/><path d="M12 10.5v5M9.8 13.5l2.2 2.2 2.2-2.2"/>`,
    jump: '<circle cx="15.5" cy="12" r="6"/><circle cx="15.5" cy="12" r="2.5"/><path d="M2 12h9.5M8.5 9l3 3-3 3"/>',
    land: '<path d="M3 20.5h18"/><path d="M5.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M12 2.5v9M9 8.5l3 3 3-3"/>',
    'take-off': '<path d="M3 20.5h18"/><path d="M5.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M12 11.5v-9M9 5.5l3-3 3 3"/>',
    attack: CROSSHAIR,
    approach: '<path d="M5 19L17.5 6.5M9 6h9v9"/>',
    'cancel-approach': '<path d="M7 7h10v10H7z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  // Names that mean a code above.
  const ALIAS = { 'tab-trade': 'TRD', 'tab-ship': 'SHP', 'tab-research': 'RSC', 'tab-industry': 'IND', 'tab-squad': 'SQD', 'tab-missions': 'MSN', hold: 'HLD', hull: 'HUL', face: 'FACE', android: 'AND', open: '+' };
  const find = (name) => ICONS[name] ?? ICONS[ALIAS[name]] ?? null;

  return {
    has: (name) => find(name) !== null,
    svg: (name, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${find(name)}</svg>`,
    get names() { return Object.keys(ICONS); },
  };
})();

export { Glyphs };
