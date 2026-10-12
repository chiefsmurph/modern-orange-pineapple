// Swatch colours for the colour picker: Printful's own colour codes per catalog
// product (GET https://api.printful.com/products/<id>, 2026-10-12). Two codes =
// a two-tone item (e.g. a snapback's crown / bill). Keys are the colour name
// lower-cased with everything but letters and digits removed.

const swatches: Record<number, Record<string, string[]>> = {
  // Comfort Colors 1717 tee
  586: {
    bay: ["#b8bfab"],
    berry: ["#8e5a7b"],
    black: ["#1b1b1c"],
    blossom: ["#ffd6e1"],
    bluejean: ["#707e8d"],
    bluespruce: ["#4c6151"],
    brick: ["#8d4b54"],
    burntorange: ["#ff7842"],
    butter: ["#ffe09e"],
    chalkymint: ["#a1f2dc"],
    chambray: ["#d9f3ff"],
    crimson: ["#bb5151"],
    crunchberry: ["#ff748e"],
    denim: ["#565a67"],
    emerald: ["#306d6e"],
    espresso: ["#87634a"],
    floblue: ["#7888d2"],
    granite: ["#a6abaa"],
    grape: ["#644e6d"],
    graphite: ["#3e3737"],
    grey: ["#92928f"],
    hemp: ["#4f5232"],
    iceblue: ["#7a9096"],
    islandreef: ["#b8ffca"],
    ivory: ["#fff4d9"],
    khaki: ["#b3ab8b"],
    lagoonblue: ["#92dedb"],
    lightgreen: ["#608267"],
    midnight: ["#3a4e63"],
    moss: ["#6b7053"],
    mustard: ["#ffbc5a"],
    mysticblue: ["#5068ab"],
    navy: ["#424150"],
    neonlemon: ["#efff99"],
    neonpink: ["#ff5ea1"],
    orchid: ["#ead3f2"],
    paprika: ["#fe4747"],
    pepper: ["#514f4c"],
    red: ["#bb1035"],
    sage: ["#49482e"],
    sandstone: ["#938a6f"],
    seafoam: ["#69a999"],
    terracotta: ["#ff9364"],
    truenavy: ["#1e2c4a"],
    violet: ["#9a8ad2"],
    washeddenim: ["#98aed1"],
    watermelon: ["#d15c68"],
    white: ["#ffffff"],
    wine: ["#816977"],
    yam: ["#db642f"],
  },
  // AS Colour 4062 crop top
  636: {
    black: ["#151515"],
    bone: ["#ebe0d2"],
    bubblegum: ["#ffc5d4"],
    ecru: ["#fffbf2"],
    hazypink: ["#cba59b"],
    mineral: ["#8fa7a6"],
    natural: ["#fffaed"],
    orchid: ["#fff2f4"],
    palepink: ["#ffd4c5"],
    white: ["#ffffff"],
  },
  // SOL'S 11362 polo
  810: {
    black: ["#121212"],
    greymelange: ["#808080"],
    mousegrey: ["#47464a"],
    navy: ["#1a252e"],
    red: ["#df0830"],
    sand: ["#e9cfa5"],
    white: ["#ffffff"],
  },
  // Yupoong 6089M snapback
  99: {
    black: ["#2a2a2a"],
    blackneonpink: ["#2a2a2a", "#e74787"],
    blackred: ["#2a2a2a", "#dd0b2e"],
    blacksilver: ["#2a2a2a", "#9f9da5"],
    blackteal: ["#2a2a2a", "#12a7c7"],
    darkgrey: ["#666061"],
    darknavy: ["#15293a"],
    greencamo: ["#4d573e", "#9e7853"],
    heatherblack: ["#a8a59e", "#2a2a2a"],
    heathergrey: ["#a8a59e"],
    heathergreynavy: ["#a8a59e", "#303044"],
    heathergreyred: ["#a8a59e", "#dd0b2e"],
    maroon: ["#651929"],
    naturalblack: ["#f5eee1", "#2a2a2a"],
    navy: ["#303044"],
    navyred: ["#303044", "#dd0b2e"],
    red: ["#dd0b2e"],
    royalblue: ["#10337a"],
    silver: ["#9f9da5"],
    spruce: ["#183e41"],
    white: ["#ffffff"],
  },
};

const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The swatch colours for a colour name, or undefined (the picker then shows the name only). */
export const swatchFor = (
  colorName: string,
  printfulCatalogProductId?: number
): string[] | undefined => {
  const key = keyOf(colorName);
  const own = printfulCatalogProductId ? swatches[printfulCatalogProductId]?.[key] : undefined;
  if (own) return own;
  for (const table of Object.values(swatches)) if (table[key]) return table[key];
  return undefined;
};
