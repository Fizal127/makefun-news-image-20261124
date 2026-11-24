// THE WORLD IN ONE DAY — front page for Tuesday 24 November 2026.
// Fresh renderer written from scratch in this session: hand-designed 5x7 pixel
// font plus a small palette-PNG encoder. Node 22+, standard library only
// (node:fs, node:path, node:zlib). No network, no randomness, no clock, so
// every run produces a byte-identical entry.png.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- palette
const PALETTE: Array<[number, number, number]> = [
  [0xf7, 0xf1, 0xde], // 0 PAPER (cream)
  [0x0e, 0x2a, 0x52], // 1 NAVY
  [0xff, 0xff, 0xff], // 2 WHITE
  [0x11, 0x11, 0x11], // 3 BLACK
  [0xc8, 0x10, 0x2e], // 4 RED
  [0x1e, 0x7a, 0x34], // 5 GREEN
  [0xd9, 0xa4, 0x04], // 6 GOLD
  [0x25, 0x63, 0xa8], // 7 BLUE
  [0x0e, 0x7c, 0x7b], // 8 TEAL
  [0xe0, 0x6a, 0x00], // 9 ORANGE
  [0x6b, 0x3f, 0xa0], // 10 PURPLE
  [0x8a, 0x5a, 0x2b], // 11 BROWN
  [0xc2, 0x18, 0x5b], // 12 PINK
];
const PAPER = 0;
const NAVY = 1;
const WHITE = 2;
const BLACK = 3;
const RED = 4;
const GREEN = 5;
const GOLD = 6;
const BLUE = 7;
const TEAL = 8;
const ORANGE = 9;
const PURPLE = 10;
const BROWN = 11;
const PINK = 12;

// ---------------------------------------------------------------- CRC32
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- PNG encoder (8-bit palette, non-interlaced)
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(idx: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type 3 = palette
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.alloc(PALETTE.length * 3);
  PALETTE.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });
  const raw = Buffer.alloc(h * (1 + w));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw[y * (1 + w) + 1 + x] = idx[y * w + x];
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H);

function setPix(x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  px[y * W + x] = c;
}

function fillRect(x: number, y: number, w: number, h: number, c: number): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) px[yy * W + xx] = c;
  }
}

function rectOutline(x: number, y: number, w: number, h: number, c: number): void {
  fillRect(x, y, w, 1, c);
  fillRect(x, y + h - 1, w, 1, c);
  fillRect(x, y, 1, h, c);
  fillRect(x + w - 1, y, 1, h, c);
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: number): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPix(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, c: number): void {
  drawLine(x0, y0, x1, y1, c);
  drawLine(x0, y0 + 1, x1, y1 + 1, c);
  drawLine(x0, y0 - 1, x1, y1 - 1, c);
}

function drawCircle(cx: number, cy: number, r: number, c: number): void {
  let x = 0;
  let y = r;
  let d = 3 - 2 * r;
  const plot = (ox: number, oy: number): void => {
    setPix(cx + ox, cy + oy, c);
    setPix(cx - ox, cy + oy, c);
    setPix(cx + ox, cy - oy, c);
    setPix(cx - ox, cy - oy, c);
    setPix(cx + oy, cy + ox, c);
    setPix(cx - oy, cy + ox, c);
    setPix(cx + oy, cy - ox, c);
    setPix(cx - oy, cy - ox, c);
  };
  while (x <= y) {
    plot(x, y);
    if (d < 0) d += 4 * x + 6;
    else {
      d += 4 * (x - y) + 10;
      y--;
    }
    x++;
  }
}

function fillDiamond(cx: number, cy: number, r: number, c: number): void {
  for (let i = 0; i <= r; i++) {
    fillRect(cx - i, cy - r + i, 2 * i + 1, 1, c);
    if (i !== r) fillRect(cx - i, cy + r - i, 2 * i + 1, 1, c);
  }
}

// ---------------------------------------------------------------- 5x7 pixel font (hand-designed in this session)
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".....", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".....", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "&": [".###.", "#...#", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", "#..#.", "#...#"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "·": [".....", ".....", ".....", ".##..", ".....", ".....", "....."],
};
const BLANK = [".....", ".....", ".....", ".....", ".....", ".....", "....."];

function textWidth(s: string, scale: number): number {
  if (s.length === 0) return 0;
  return s.length * 6 * scale - scale;
}

function drawText(
  s: string,
  x: number,
  y: number,
  scale: number,
  c: number,
  align: "left" | "center" | "right" = "left",
): void {
  const up = s.toUpperCase();
  let x0 = x;
  if (align === "center") x0 = x - Math.floor(textWidth(up, scale) / 2);
  if (align === "right") x0 = x - textWidth(up, scale);
  let cx = x0;
  for (const ch of up) {
    const g = GLYPHS[ch] ?? BLANK;
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === "#") fillRect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function wrapWords(s: string, maxChars: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawWrapped(
  s: string,
  x: number,
  y: number,
  scale: number,
  c: number,
  maxChars: number,
  lineGap = 2,
): void {
  const lines = wrapWords(s, maxChars);
  lines.forEach((ln, i) => drawText(ln, x, y + i * (7 * scale + lineGap), scale, c));
}

// ---------------------------------------------------------------- stories (35 total)
// Lead (1) + second row (2, 3) are drawn by hand below; grid holds 4..27,
// ALSO TODAY holds 28..35.
type Story = { tag: string; color: number; head: string };
const GRID: Story[] = [
  { tag: "UKRAINE", color: RED, head: "MOSCOW: ESTONIA RISKS OPEN WAR" },
  { tag: "UKRAINE", color: RED, head: "KYIV REGION STRIKES KILL 15" },
  { tag: "UKRAINE", color: BLUE, head: "KYIV: WARSHIP SUNK OFF LIBYA" },
  { tag: "BALTIC", color: BLUE, head: "DRONE HIT SETS SHIP ABLAZE" },
  { tag: "MIDDLE EAST", color: BROWN, head: "TRUMP WARNS IRAN OF TRAUMATIC END" },
  { tag: "MIDDLE EAST", color: RED, head: "IRAN VOWS TO FIGHT BLOCKADE" },
  { tag: "MIDDLE EAST", color: ORANGE, head: "GAZA STRIKES KILL UN WORKER" },
  { tag: "MIDDLE EAST", color: GREEN, head: "GAZA POISONED FOR DECADES" },
  { tag: "INDIA", color: PINK, head: "INDIA GIVES NEPAL $1.6BN" },
  { tag: "INDIA", color: TEAL, head: "MODI OPENS AI HUB AT IIT PATNA" },
  { tag: "INDIA", color: BLUE, head: "INDIA-CHINA BORDER TALKS" },
  { tag: "EUROPE", color: BLUE, head: "DENMARK UPHOLDS 'GHETTO LAW'" },
  { tag: "EUROPE", color: PURPLE, head: "TAJIKISTAN MOVES TO QUIT THE ICC" },
  { tag: "EUROPE", color: ORANGE, head: "FAR LEFT MARCHES IN FRANCE" },
  { tag: "AFRICA", color: ORANGE, head: "AFCON TITLE IN COURT BATTLE" },
  { tag: "AFRICA", color: BROWN, head: "PREACHER HELD IN ZIMBABWE" },
  { tag: "ASIA", color: TEAL, head: "TALIBAN ERASES WOMEN'S NAMES" },
  { tag: "ASIA", color: GREEN, head: "TYPHOID JABS FOR BANGLADESH" },
  { tag: "US", color: NAVY, head: "COURT MAY ERASE TRUMP CONVICTION" },
  { tag: "US", color: RED, head: "TWO DEAD IN US CAMPUS SHOOTING" },
  { tag: "TECH", color: BLUE, head: "WAYMO OFF THE FREEWAYS" },
  { tag: "BUSINESS", color: TEAL, head: "SOFTBANK TO PUT $2BN INTO INTEL" },
  { tag: "SPORT", color: ORANGE, head: "WOMEN'S WORLD CUP HOSTS NAMED" },
  { tag: "SPORT", color: BLUE, head: "CHESS CROWN DEFENCE BEGINS" },
];
const ALSO: string[] = [
  "ALCARAZ WINS FIRST ATP FINALS TITLE",
  "INDIA-NZ TEST ENDS IN DRAW",
  "DE BRUYNE: CITY LOVE NEVER CHANGES",
  "TOP COURT BAILS GODHRA CONVICT",
  "US MIDTERMS CERTIFIED",
  "SUPERMOON MEETS THE SEVEN SISTERS",
  "INDIA PRIVATE SECTOR GROWS",
  "SINGER FLOGGED IN IRAN",
];

// ---------------------------------------------------------------- page layout
function drawPage(): void {
  fillRect(0, 0, W, H, PAPER);
  // outer border
  fillRect(0, 0, W, 3, BLACK);
  fillRect(0, H - 3, W, 3, BLACK);
  fillRect(0, 0, 3, H, BLACK);
  fillRect(W - 3, 0, 3, H, BLACK);

  // ---- masthead
  fillRect(8, 8, 1008, 104, NAVY);
  drawText("THE WORLD IN ONE DAY", 512, 14, 2, GOLD, "center");
  drawText("TUESDAY 24 NOVEMBER 2026", 512, 34, 6, WHITE, "center");
  fillRect(48, 82, 928, 2, GOLD);
  drawText("ONE DAY · ONE PICTURE · THE WORLD'S NEWS", 512, 90, 1, GOLD, "center");
  fillRect(8, 118, 1008, 3, RED);

  // ---- lead story: Nvidia / Huang
  drawText("TECH · MARKETS", 24, 130, 2, RED);
  drawText("HUANG IS BACK", 24, 156, 7, BLACK);
  drawText("NVIDIA REINSTATES ITS CEO", 24, 212, 3, BLACK);
  drawText("BOARD REVERSES COURSE AS SHARES SOAR", 24, 240, 2, BLACK);
  // rising chart, right side
  fillRect(660, 140, 2, 134, BLACK);
  fillRect(660, 272, 340, 2, BLACK);
  const pts: Array<[number, number]> = [
    [668, 266],
    [720, 250],
    [772, 238],
    [824, 220],
    [876, 194],
    [928, 174],
    [984, 152],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], GREEN);
  }
  drawLine(984, 152, 966, 158, GREEN);
  drawLine(984, 152, 976, 168, GREEN);
  drawText("+31%", 810, 138, 4, GREEN);
  fillRect(8, 302, 1008, 2, BLACK);

  // ---- second stories
  // climate
  rectOutline(8, 308, 500, 110, BLACK);
  fillRect(9, 309, 498, 6, GREEN);
  drawText("CLIMATE", 20, 322, 2, GREEN);
  drawText("CLIMATE TALKS", 20, 340, 4, BLACK);
  drawText("COLLAPSE", 20, 370, 4, BLACK);
  drawText("COP31 ENDS WITH NO DEAL", 20, 404, 1, BLACK);
  drawCircle(470, 330, 13, GREEN);
  drawLine(461, 321, 479, 339, GREEN);
  // factory fire
  rectOutline(516, 308, 500, 110, BLACK);
  fillRect(517, 309, 498, 6, RED);
  drawText("INDONESIA", 528, 322, 2, RED);
  drawText("FACTORY FIRE: 24", 528, 340, 4, BLACK);
  drawText("DEAD", 528, 370, 4, BLACK);
  drawText("24 DEAD IN JAVA CANDY PLANT", 528, 404, 1, BLACK);
  fillDiamond(972, 330, 11, RED);
  fillDiamond(972, 330, 5, ORANGE);

  fillRect(8, 424, 1008, 2, BLACK);

  // ---- grid: 24 stories, 3 columns x 8 rows
  const colX = [8, 348, 688];
  GRID.forEach((st, i) => {
    const cx = colX[i % 3];
    const cy = 430 + Math.floor(i / 3) * 62;
    rectOutline(cx, cy, 328, 60, BLACK);
    fillRect(cx + 1, cy + 1, 326, 5, st.color);
    drawText(st.tag, cx + 8, cy + 10, 1, st.color);
    drawWrapped(st.head, cx + 8, cy + 21, 2, BLACK, 24, 2);
  });

  // ---- ALSO TODAY strip
  fillRect(8, 930, 1008, 22, NAVY);
  drawText("ALSO TODAY", 16, 935, 2, GOLD);
  const alsoX = [16, 268, 520, 772];
  ALSO.forEach((s, i) => {
    const ax = alsoX[i % 4];
    const ay = 958 + Math.floor(i / 4) * 32;
    fillRect(ax, ay + 1, 6, 6, RED);
    drawWrapped(s, ax + 10, ay, 1, BLACK, 24, 2);
  });
}

// ---------------------------------------------------------------- main
const outDir = process.argv[2] ?? ".";
drawPage();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), encodePNG(px, W, H));
console.log("wrote", join(outDir, "entry.png"));
