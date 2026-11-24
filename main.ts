// news-image-20261124 — "The World in One Day"
// A from-scratch newspaper front page for Tuesday 24 November 2026,
// rendered as a 1024x1024 palette PNG using only the Node 22 standard
// library. No network, no randomness, no clock: every run writes the
// same bytes.
//
// How it works: everything is drawn pixel by pixel into an indexed
// canvas (one byte per pixel, an index into a fixed 28-colour palette),
// then encoded by hand as PNG (IHDR / PLTE / IDAT / IEND) with a
// hand-rolled CRC32 and node:zlib. Headlines are set in a hand-designed
// 5x7 pixel font (capitals only) at integer scales, so the type stays
// crisp. Story art is small geometric pictograms, not photographs.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WIDTH = 1024;
export const HEIGHT = 1024;

// ---------------------------------------------------------------- palette
// The whole page uses 28 colours. Index 0 is the paper cream.
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [246, 241, 229], // 0  paper
  [27, 27, 27], // 1  ink
  [20, 39, 62], // 2  navy
  [31, 58, 92], // 3  navy light
  [179, 35, 27], // 4  red
  [140, 26, 20], // 5  red dark
  [201, 162, 39], // 6  gold
  [227, 199, 102], // 7  gold light
  [255, 253, 245], // 8  card white
  [107, 107, 102], // 9  grey
  [216, 210, 192], // 10 rule grey
  [30, 122, 52], // 11 green
  [76, 175, 109], // 12 green light
  [37, 99, 168], // 13 blue
  [15, 118, 110], // 14 teal
  [217, 108, 30], // 15 orange
  [107, 63, 160], // 16 purple
  [122, 74, 33], // 17 brown
  [194, 67, 122], // 18 pink
  [127, 179, 213], // 19 sky
  [20, 83, 45], // 20 dark green
  [255, 255, 255], // 21 white
  [0, 0, 0], // 22 black
  [242, 194, 0], // 23 yellow
  [59, 74, 140], // 24 indigo
  [140, 109, 31], // 25 ochre
  [232, 226, 208], // 26 pale card
  [90, 32, 28], // 27 maroon
];

// Named aliases so the layout code reads like a style sheet.
const PAPER = 0;
const INK = 1;
const NAVY = 2;
const NAVY_LIGHT = 3;
const RED = 4;
const RED_DARK = 5;
const GOLD = 6;
const GOLD_LIGHT = 7;
const CARD = 8;
const GREY = 9;
const RULE = 10;
const GREEN = 11;
const GREEN_LIGHT = 12;
const BLUE = 13;
const TEAL = 14;
const ORANGE = 15;
const PURPLE = 16;
const BROWN = 17;
const PINK = 18;
const SKY = 19;
const DARK_GREEN = 20;
const WHITE = 21;
const BLACK = 22;
const YELLOW = 23;
const INDIGO = 24;
const OCHRE = 25;
const PALE = 26;
const MAROON = 27;

// ------------------------------------------------------------------ canvas
const canvas = new Uint8Array(WIDTH * HEIGHT).fill(PAPER);

function setPixel(x: number, y: number, colour: number): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  canvas[y * WIDTH + x] = colour;
}

function fillRect(x: number, y: number, w: number, h: number, colour: number): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(WIDTH, x + w);
  const y1 = Math.min(HEIGHT, y + h);
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * WIDTH;
    for (let xx = x0; xx < x1; xx++) canvas[row + xx] = colour;
  }
}

function strokeRect(x: number, y: number, w: number, h: number, colour: number, t = 1): void {
  fillRect(x, y, w, t, colour);
  fillRect(x, y + h - t, w, t, colour);
  fillRect(x, y, t, h, colour);
  fillRect(x + w - t, y, t, h, colour);
}

function hline(x: number, y: number, w: number, colour: number, t = 1): void {
  fillRect(x, y, w, t, colour);
}

function vline(x: number, y: number, h: number, colour: number, t = 1): void {
  fillRect(x, y, t, h, colour);
}

// Bresenham line, any slope. Coordinates are rounded first, so callers
// may pass fractional icon geometry; exact equality is what ends the loop.
function line(x0: number, y0: number, x1: number, y1: number, colour: number, t = 1): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, colour);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, colour: number): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - half, cy + y, half * 2 + 1, 1, colour);
  }
}

function strokeCircle(cx: number, cy: number, r: number, colour: number, t = 1): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    const x = Math.round(cx + r * Math.cos(rad));
    const y = Math.round(cy + r * Math.sin(rad));
    fillRect(x, y, t, t, colour);
  }
}

// Filled triangle: scanline fill between the three edges.
function fillTriangle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: number,
): void {
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: Array<[[number, number], [number, number]]> = [
      [[x0, y0], [x1, y1]],
      [[x1, y1], [x2, y2]],
      [[x2, y2], [x0, y0]],
    ];
    for (const [[ax, ay], [bx, by]] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const a = Math.min(...xs);
      const b = Math.max(...xs);
      fillRect(Math.round(a), y, Math.round(b) - Math.round(a) + 1, 1, colour);
    }
  }
}

// -------------------------------------------------------------- PNG output
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type 3: indexed
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const plte = Buffer.alloc(PALETTE.length * 3);
  PALETTE.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });

  const raw = Buffer.alloc(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (WIDTH + 1)] = 0; // filter: none
    raw.set(canvas.subarray(y * WIDTH, (y + 1) * WIDTH), y * (WIDTH + 1) + 1);
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

// ------------------------------------------------------------------- font
// A hand-designed 5x7 pixel font. Each glyph is 7 rows; each row is a
// 5-bit number, bit 4 = leftmost pixel. Only capitals are drawn: all text
// is upper-cased before rendering, in the style of a newspaper headline.
type Glyph = readonly [number, number, number, number, number, number, number];

const FONT: Record<string, Glyph> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b01100, 0b00100, 0b01000],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  ";": [0, 0b01100, 0b01100, 0, 0b01100, 0b00100, 0b01000],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
  "-": [0, 0, 0, 0b01110, 0, 0, 0],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  "%": [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "+": [0, 0b00100, 0b00100, 0b01110, 0b00100, 0b00100, 0],
  "=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
  "'": [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  '"': [0b01010, 0b01010, 0b01010, 0, 0, 0, 0],
  "*": [0, 0b10101, 0b01110, 0b10101, 0, 0, 0],
  "#": [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  _: [0, 0, 0, 0, 0, 0, 0b11111],
  "·": [0, 0, 0, 0, 0b01100, 0b01100, 0],
  "×": [0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0],
  "•": [0, 0b01110, 0b11111, 0b11111, 0b11111, 0b01110, 0],
};

// Normalise a string for the font: upper-case, straight quotes/dashes.
function normalise(text: string): string {
  return text
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...");
}

const CHAR_ADVANCE = 6; // 5 glyph columns + 1 blank column

function textWidth(text: string, scale: number): number {
  const t = normalise(text);
  return t.length === 0 ? 0 : (t.length * CHAR_ADVANCE - 1) * scale;
}

// Draw one line of text at (x, y) — the top-left of the first glyph.
function drawText(x: number, y: number, text: string, scale: number, colour: number): void {
  const t = normalise(text);
  let cx = x;
  for (const ch of t) {
    const glyph = FONT[ch] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          fillRect(cx + col * scale, y + row * scale, scale, scale, colour);
        }
      }
    }
    cx += CHAR_ADVANCE * scale;
  }
}

function drawTextCentred(cx: number, y: number, text: string, scale: number, colour: number): void {
  drawText(cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, colour);
}

// Greedy word wrap: returns lines that each fit maxWidth pixels at scale.
function wrapText(text: string, scale: number, maxWidth: number): string[] {
  const words = normalise(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current === "" ? word : `${current} ${word}`;
    if (textWidth(trial, scale) <= maxWidth || current === "") {
      current = trial;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

// Draw wrapped text, left-aligned, line height = 7*scale + 3.
function drawWrapped(
  x: number,
  y: number,
  text: string,
  scale: number,
  maxWidth: number,
  colour: number,
  maxLines = 99,
): number {
  const lines = wrapText(text, scale, maxWidth).slice(0, maxLines);
  const lh = 7 * scale + 3;
  lines.forEach((ln, i) => drawText(x, y + i * lh, ln, scale, colour));
  return lines.length;
}

// -------------------------------------------------------------- pictograms
// Small geometric icons drawn in a square box of side `s` at (x, y).
// Each is a few rectangles / circles / triangles — a visual anchor for a
// story tile, not a picture of anything copyrighted. All geometry is
// expressed in units of u = s/10 so an icon scales cleanly.
function iconFlame(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillTriangle(x + 5 * u, y + 9 * u, x + 2 * u, y + 5 * u, x + 5 * u, y + 1 * u, c);
  fillTriangle(x + 5 * u, y + 9 * u, x + 8 * u, y + 5 * u, x + 5 * u, y + 1 * u, c);
  fillCircle(x + 5 * u, y + 6.5 * u, 2.6 * u, c);
  fillRect(x + 2 * u, y + 9 * u, 6 * u, u, c);
}
function iconShip(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 1 * u, y + 6 * u, 8 * u, 2.4 * u, c);
  fillTriangle(x + 1 * u, y + 6 * u, x + 9 * u, y + 6 * u, x + 8 * u, y + 8.4 * u, c);
  vline(x + 5 * u, y + 1 * u, 5 * u, c, Math.max(1, u));
  fillTriangle(x + 5 * u, y + 1 * u, x + 5 * u, y + 4 * u, x + 8 * u, y + 4 * u, c);
}
function iconGlobe(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  strokeCircle(x + 5 * u, y + 5 * u, 4 * u, c, Math.max(1, u));
  hline(x + 1.4 * u, y + 5 * u, 7.2 * u, c, Math.max(1, u));
  line(x + 2 * u, y + 2 * u, x + 8 * u, y + 8 * u, c, Math.max(1, u));
}
function iconGavel(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 1 * u, y + 1 * u, 5 * u, 2.6 * u, c);
  line(x + 6 * u, y + 4 * u, x + 9 * u, y + 8 * u, c, Math.max(1, 1.4 * u));
  fillRect(x + 1 * u, y + 8.4 * u, 8 * u, u, c);
}
function iconBall(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  strokeCircle(x + 5 * u, y + 5 * u, 4 * u, c, Math.max(1, u));
  fillCircle(x + 5 * u, y + 5 * u, 1.4 * u, c);
  line(x + 5 * u, y + 1 * u, x + 5 * u, y + 3.4 * u, c, Math.max(1, u));
  line(x + 5 * u, y + 6.6 * u, x + 5 * u, y + 9 * u, c, Math.max(1, u));
  line(x + 1 * u, y + 5 * u, x + 3.4 * u, y + 5 * u, c, Math.max(1, u));
  line(x + 6.6 * u, y + 5 * u, x + 9 * u, y + 5 * u, c, Math.max(1, u));
}
function iconChess(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillCircle(x + 5 * u, y + 2.4 * u, 1.8 * u, c);
  fillTriangle(x + 3 * u, y + 8.6 * u, x + 7 * u, y + 8.6 * u, x + 5 * u, y + 3.6 * u, c);
  fillRect(x + 2 * u, y + 8.6 * u, 6 * u, u, c);
}
function iconChip(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 2.6 * u, y + 2.6 * u, 4.8 * u, 4.8 * u, c);
  fillRect(x + 4 * u, y + 4 * u, 2 * u, 2 * u, PAPER);
  for (let i = 0; i < 3; i++) {
    fillRect(x + (3.4 + i * 1.6) * u, y + 0.6 * u, u, 2 * u, c);
    fillRect(x + (3.4 + i * 1.6) * u, y + 7.4 * u, u, 2 * u, c);
    fillRect(x + 0.6 * u, y + (3.4 + i * 1.6) * u, 2 * u, u, c);
    fillRect(x + 7.4 * u, y + (3.4 + i * 1.6) * u, 2 * u, u, c);
  }
}
function iconFactory(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 1 * u, y + 4 * u, 8 * u, 5 * u, c);
  fillRect(x + 1.6 * u, y + 1 * u, 1.6 * u, 3 * u, c);
  fillRect(x + 2.4 * u, y + 6 * u, 1.4 * u, 1.4 * u, PAPER);
  fillRect(x + 5 * u, y + 6 * u, 1.4 * u, 1.4 * u, PAPER);
}
function iconMoon(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillCircle(x + 5 * u, y + 5 * u, 4 * u, c);
  fillCircle(x + 6.6 * u, y + 3.8 * u, 3.2 * u, PAPER);
  fillCircle(x + 2.2 * u, y + 8.4 * u, 0.7 * u, c);
  fillCircle(x + 8.4 * u, y + 8.6 * u, 0.7 * u, c);
}
function iconCar(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 1 * u, y + 4.6 * u, 8 * u, 2.6 * u, c);
  fillRect(x + 2.6 * u, y + 2.6 * u, 4.8 * u, 2.2 * u, c);
  fillCircle(x + 3 * u, y + 7.6 * u, 1.3 * u, c);
  fillCircle(x + 7 * u, y + 7.6 * u, 1.3 * u, c);
}
function iconSyringe(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  line(x + 2 * u, y + 8 * u, x + 8 * u, y + 2 * u, c, Math.max(1, 1.6 * u));
  line(x + 6.4 * u, y + 1.4 * u, x + 8.6 * u, y + 3.6 * u, c, Math.max(1, u));
  line(x + 1 * u, y + 6.6 * u, x + 3.2 * u, y + 8.8 * u, c, Math.max(1, u));
}
function iconScales(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  vline(x + 5 * u, y + 1 * u, 7 * u, c, Math.max(1, u));
  hline(x + 1.6 * u, y + 2.4 * u, 6.8 * u, c, Math.max(1, u));
  fillTriangle(x + 0.6 * u, y + 4.4 * u, x + 3.4 * u, y + 4.4 * u, x + 2 * u, y + 6.6 * u, c);
  fillTriangle(x + 6.6 * u, y + 4.4 * u, x + 9.4 * u, y + 4.4 * u, x + 8 * u, y + 6.6 * u, c);
  fillRect(x + 2.6 * u, y + 8.4 * u, 4.8 * u, u, c);
}
function iconMegaphone(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillTriangle(x + 1 * u, y + 3.4 * u, x + 1 * u, y + 6.6 * u, x + 8.6 * u, y + 9 * u, c);
  fillTriangle(x + 1 * u, y + 3.4 * u, x + 8.6 * u, y + 1 * u, x + 8.6 * u, y + 9 * u, c);
  fillRect(x + 1 * u, y + 3.4 * u, 2.4 * u, 3.2 * u, c);
  fillRect(x + 3.4 * u, y + 6.6 * u, 1.6 * u, 2.4 * u, c);
}
function iconBallot(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillRect(x + 1.4 * u, y + 3.4 * u, 7.2 * u, 5.6 * u, c);
  fillRect(x + 3 * u, y + 1 * u, 4 * u, 2.4 * u, c);
  line(x + 3 * u, y + 6.4 * u, x + 4.4 * u, y + 7.8 * u, PAPER, Math.max(1, u));
  line(x + 4.4 * u, y + 7.8 * u, x + 7.4 * u, y + 4.6 * u, PAPER, Math.max(1, u));
}
function iconWarning(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillTriangle(x + 5 * u, y + 0.6 * u, x + 0.8 * u, y + 8.6 * u, x + 9.2 * u, y + 8.6 * u, c);
  fillRect(x + 4.5 * u, y + 3.4 * u, u, 2.6 * u, PAPER);
  fillRect(x + 4.5 * u, y + 6.6 * u, u, u, PAPER);
}
function iconRocket(x: number, y: number, s: number, c: number): void {
  const u = s / 10;
  fillTriangle(x + 5 * u, y + 0.6 * u, x + 3 * u, y + 6 * u, x + 7 * u, y + 6 * u, c);
  fillRect(x + 3.4 * u, y + 6 * u, 3.2 * u, 2 * u, c);
  fillTriangle(x + 3 * u, y + 6 * u, x + 1.6 * u, y + 9 * u, x + 3.6 * u, y + 8 * u, c);
  fillTriangle(x + 7 * u, y + 6 * u, x + 8.4 * u, y + 9 * u, x + 6.4 * u, y + 8 * u, c);
}
function iconDollar(x: number, y: number, s: number, c: number): void {
  drawText(x, y, "$", 2, c);
}

type IconKind =
  | "flame" | "ship" | "globe" | "gavel" | "ball" | "chess" | "chip"
  | "factory" | "moon" | "car" | "syringe" | "scales" | "megaphone"
  | "ballot" | "warning" | "rocket" | "dollar";

const ICONS: Record<IconKind, (x: number, y: number, s: number, c: number) => void> = {
  flame: iconFlame, ship: iconShip, globe: iconGlobe, gavel: iconGavel,
  ball: iconBall, chess: iconChess, chip: iconChip, factory: iconFactory,
  moon: iconMoon, car: iconCar, syringe: iconSyringe, scales: iconScales,
  megaphone: iconMegaphone, ballot: iconBallot, warning: iconWarning,
  rocket: iconRocket, dollar: iconDollar,
};

function drawIcon(kind: IconKind, x: number, y: number, s: number, colour: number): void {
  ICONS[kind](x, y, s, colour);
}

// ------------------------------------------------------------ layout bits
// A white story card with a coloured top bar and a thin ink outline.
function card(x: number, y: number, w: number, h: number, accent: number): void {
  fillRect(x, y, w, h, CARD);
  fillRect(x, y, w, 5, accent);
  strokeRect(x, y, w, h, INK, 1);
}

// ------------------------------------------------------------- the stories
// All 35 stories were first reported, or developed, on Tuesday 24 November
// 2026 (in at least one time zone), drawn from that day's front pages:
// the Nvidia comeback, COP31's collapse, the Java factory fire, the
// Ukraine war's spillover to Libya and the Baltic, the Hormuz standoff,
// Gaza, India, Europe, Africa, Asia, the US, tech, business and sport.
interface Tile {
  tag: string;
  headline: string;
  accent: number;
  icon: IconKind;
}

const LEAD_TAG = "TECH · MARKETS";
const LEAD_HEADLINE = "HUANG IS BACK";
const LEAD_SUB = "NVIDIA REINSTATES ITS CEO";

const SECOND_A: Tile = {
  tag: "CLIMATE",
  headline: "CLIMATE TALKS COLLAPSE",
  accent: GREEN,
  icon: "globe",
};
const SECOND_B: Tile = {
  tag: "INDONESIA",
  headline: "FACTORY FIRE: 24 DEAD",
  accent: RED,
  icon: "flame",
};

const GRID: Tile[] = [
  { tag: "UKRAINE", headline: "MOSCOW: ESTONIA RISKS OPEN WAR", accent: RED, icon: "warning" },
  { tag: "UKRAINE", headline: "KYIV REGION STRIKES KILL 15", accent: RED, icon: "flame" },
  { tag: "UKRAINE", headline: "KYIV: WARSHIP SUNK OFF LIBYA", accent: BLUE, icon: "ship" },
  { tag: "BALTIC", headline: "DRONE HIT SETS SHIP ABLAZE", accent: SKY, icon: "ship" },
  { tag: "MIDDLE EAST", headline: "TRUMP WARNS IRAN OF TRAUMATIC END", accent: MAROON, icon: "megaphone" },
  { tag: "MIDDLE EAST", headline: "IRAN VOWS TO FIGHT BLOCKADE", accent: MAROON, icon: "ship" },
  { tag: "MIDDLE EAST", headline: "GAZA STRIKES KILL UN WORKER", accent: BROWN, icon: "warning" },
  { tag: "MIDDLE EAST", headline: "GAZA POISONED FOR DECADES", accent: GREEN, icon: "warning" },
  { tag: "INDIA", headline: "INDIA GIVES NEPAL $1.6BN", accent: PINK, icon: "dollar" },
  { tag: "INDIA", headline: "MODI OPENS AI HUB AT IIT PATNA", accent: ORANGE, icon: "chip" },
  { tag: "INDIA", headline: "INDIA-CHINA BORDER TALKS", accent: TEAL, icon: "globe" },
  { tag: "EUROPE", headline: "DENMARK UPHOLDS 'GHETTO LAW'", accent: INDIGO, icon: "gavel" },
  { tag: "EUROPE", headline: "TAJIKISTAN MOVES TO QUIT THE ICC", accent: INDIGO, icon: "scales" },
  { tag: "EUROPE", headline: "FAR LEFT MARCHES IN FRANCE", accent: PURPLE, icon: "megaphone" },
  { tag: "AFRICA", headline: "AFCON TITLE IN COURT BATTLE", accent: ORANGE, icon: "ball" },
  { tag: "AFRICA", headline: "PREACHER HELD IN ZIMBABWE", accent: OCHRE, icon: "gavel" },
  { tag: "ASIA", headline: "TALIBAN ERASES WOMEN'S NAMES", accent: TEAL, icon: "warning" },
  { tag: "ASIA", headline: "TYPHOID JABS FOR BANGLADESH", accent: GREEN, icon: "syringe" },
  { tag: "US", headline: "COURT MAY ERASE TRUMP CONVICTION", accent: NAVY, icon: "scales" },
  { tag: "US", headline: "TWO DEAD IN US CAMPUS SHOOTING", accent: RED, icon: "warning" },
  { tag: "TECH", headline: "WAYMO OFF THE FREEWAYS", accent: BLUE, icon: "car" },
  { tag: "BUSINESS", headline: "SOFTBANK TO PUT $2BN INTO INTEL", accent: TEAL, icon: "dollar" },
  { tag: "SPORT", headline: "WOMEN'S WORLD CUP HOSTS NAMED", accent: ORANGE, icon: "ball" },
  { tag: "SPORT", headline: "CHESS CROWN DEFENCE BEGINS", accent: INDIGO, icon: "chess" },
];

const TICKER: string[] = [
  "ALCARAZ WINS FIRST ATP FINALS TITLE",
  "INDIA-NZ TEST ENDS IN DRAW",
  "DE BRUYNE: CITY LOVE NEVER CHANGES",
  "TOP COURT BAILS GODHRA CONVICT",
  "US MIDTERMS CERTIFIED",
  "SUPERMOON MEETS THE SEVEN SISTERS",
  "INDIA PRIVATE SECTOR GROWS",
  "SINGER FLOGGED IN IRAN",
];

// ------------------------------------------------------------------- page
function drawMasthead(): void {
  fillRect(10, 10, 1004, 108, NAVY);
  drawTextCentred(512, 22, "THE WORLD IN ONE DAY", 3, GOLD);
  drawTextCentred(512, 50, "TUESDAY 24 NOVEMBER 2026", 6, WHITE);
  hline(60, 99, 904, GOLD, 2);
  drawTextCentred(512, 104, "ONE DAY · ONE PICTURE · THE WORLD'S NEWS", 2, GOLD_LIGHT);
}

function drawLead(): void {
  const x = 10;
  const y = 124;
  const w = 1004;
  const h = 130;
  card(x, y, w, h, RED);
  drawText(x + 16, y + 12, LEAD_TAG, 2, RED);
  drawText(x + 16, y + 34, LEAD_HEADLINE, 7, INK);
  drawText(x + 16, y + 98, LEAD_SUB, 3, INK);
  // Right-hand panel: a chip, the day's jump, and a rising line chart.
  drawIcon("chip", 700, 138, 36, GREEN);
  drawText(748, 140, "+31%", 5, GREEN);
  const pts: Array<[number, number]> = [
    [700, 230], [760, 214], [820, 196], [880, 178], [940, 156],
  ];
  for (let i = 0; i < pts.length; i++) fillCircle(pts[i][0], pts[i][1], 3, GREEN);
  for (let i = 0; i + 1 < pts.length; i++) {
    line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], GREEN, 4);
  }
  // Arrowhead on the last point, pointing up-right.
  fillTriangle(940, 156, 922, 158, 936, 172, GREEN);
  hline(690, 240, 270, RULE, 1);
}

function drawSecondary(tile: Tile, x: number, y: number): void {
  const w = 496;
  const h = 100;
  card(x, y, w, h, tile.accent);
  drawText(x + 16, y + 12, tile.tag, 2, tile.accent);
  drawIcon(tile.icon, x + w - 46, y + 10, 30, tile.accent);
  drawWrapped(x + 16, y + 32, tile.headline, 4, w - 32, INK, 2);
}

function drawGridTile(tile: Tile, x: number, y: number): void {
  const w = 326;
  const h = 69;
  card(x, y, w, h, tile.accent);
  drawText(x + 10, y + 7, tile.tag, 2, tile.accent);
  drawWrapped(x + 10, y + 23, tile.headline, 3, 300, INK, 2);
}

function drawTicker(): void {
  fillRect(10, 922, 1004, 18, NAVY);
  drawText(18, 926, "ALSO TODAY", 2, GOLD);
  const colW = 243;
  TICKER.forEach((item, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 10 + col * 251;
    const y = 946 + row * 34;
    fillRect(x, y + 4, 6, 6, RED);
    drawWrapped(x + 12, y, item, 2, 227, INK, 2);
  });
}

function drawPage(): void {
  strokeRect(4, 4, 1016, 1016, INK, 2);
  drawMasthead();
  drawLead();
  drawSecondary(SECOND_A, 10, 260);
  drawSecondary(SECOND_B, 518, 260);
  GRID.forEach((tile, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    drawGridTile(tile, 10 + col * 334, 366 + row * 69);
  });
  drawTicker();
}

// -------------------------------------------------------------------- main
function main(): void {
  drawPage();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
}

main();
