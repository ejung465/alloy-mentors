/**
 * Minimal, dependency-free QR encoder (byte mode, EC level H, versions 1–6).
 * Faithful port of the standard qrcode-generator algorithm (Kazuhiko Arase).
 * Versions are capped at 6 (payloads ≤ 58 chars) so no version-info bits are
 * needed — our check-in payload is a fixed 52 chars. EC level H tolerates ~30%
 * damage, which lets AlloyQR overlay the brand chip in the middle.
 */

// ── GF(256) arithmetic ────────────────────────────────────────────────────────
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  EXP[255] = EXP[0];
})();
const gmul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]);

/** Reed-Solomon error-correction codewords for a data block. */
function rsEncode(data: number[], ecLen: number): number[] {
  // generator polynomial ∏ (x - α^i), i = 0..ecLen-1
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gmul(gen[j], EXP[i]);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }
  gen.reverse(); // highest degree first
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) res[i] ^= gmul(gen[i + 1], factor);
    }
  }
  return res;
}

// ── EC level H block structure, versions 1–6 ─────────────────────────────────
// [ecPerBlock, [dataCodewordsPerBlock, blockCount][]]
// Totals check out against the standard: 26, 44, 70, 100, 134, 172 codewords.
const H_BLOCKS: [number, [number, number][]][] = [
  [17, [[9, 1]]],
  [28, [[16, 1]]],
  [22, [[13, 2]]],
  [16, [[9, 4]]],
  [22, [[11, 2], [12, 2]]],
  [28, [[15, 4]]],
];

const dataCapacity = (v: number) =>
  H_BLOCKS[v - 1][1].reduce((a, [cw, n]) => a + cw * n, 0);

// ── Bit buffer ────────────────────────────────────────────────────────────────
class Bits {
  bytes: number[] = [];
  length = 0;
  put(value: number, count: number) {
    for (let i = count - 1; i >= 0; i--) this.putBit(((value >>> i) & 1) === 1);
  }
  putBit(bit: boolean) {
    const byteIdx = Math.floor(this.length / 8);
    if (this.bytes.length <= byteIdx) this.bytes.push(0);
    if (bit) this.bytes[byteIdx] |= 0x80 >>> this.length % 8;
    this.length++;
  }
}

// ── BCH for format info ───────────────────────────────────────────────────────
const G15 = 0b10100110111;
const G15_MASK = 0b101010000010010;
const bchDigit = (n: number) => { let d = 0; while (n !== 0) { d++; n >>>= 1; } return d; };
function formatBits(maskPattern: number): number {
  const data = (0b10 << 3) | maskPattern; // EC level H indicator = 10
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((data << 10) | d) ^ G15_MASK;
}

const maskFn = (p: number, r: number, c: number): boolean => {
  switch (p) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r * c) % 3) + ((r + c) % 2)) % 2 === 0;
  }
};

// ── Matrix construction ───────────────────────────────────────────────────────
type Cell = boolean | null;

function buildMatrix(version: number, data: number[], maskPattern: number): boolean[][] {
  const count = version * 4 + 17;
  const m: Cell[][] = Array.from({ length: count }, () => new Array<Cell>(count).fill(null));

  const setFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r < 0 || count <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c < 0 || count <= col + c) continue;
        const on =
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4);
        m[row + r][col + c] = on;
      }
    }
  };
  setFinder(0, 0);
  setFinder(count - 7, 0);
  setFinder(0, count - 7);

  // Alignment patterns (v2+ has centers at [6, 4v+10]; overlaps skip via null-check)
  if (version >= 2) {
    const pos = [6, version * 4 + 10];
    for (const row of pos) {
      for (const col of pos) {
        if (m[row][col] !== null) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            m[row + r][col + c] =
              r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < count - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }

  // Format info (two copies) + dark module
  const bits = formatBits(maskPattern);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    // vertical copy
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else m[count - 15 + i][8] = bit;
    // horizontal copy
    if (i < 8) m[8][count - i - 1] = bit;
    else if (i < 9) m[8][15 - i - 1 + 1] = bit;
    else m[8][15 - i - 1] = bit;
  }
  m[count - 8][8] = true; // dark module

  // Data placement — zigzag from bottom right
  let inc = -1;
  let row = count - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = count - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] === null) {
          let dark = false;
          if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          if (maskFn(maskPattern, row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          bitIndex--;
          if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
      }
      row += inc;
      if (row < 0 || count <= row) { row -= inc; inc = -inc; break; }
    }
  }

  return m as boolean[][];
}

// ── Mask penalty (standard 4 rules) ──────────────────────────────────────────
function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;

  // Rule 1: runs of ≥5 same modules (rows and cols)
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const cur = axis === 0 ? m[i][j] : m[j][i];
        const prev = axis === 0 ? m[i][j - 1] : m[j - 1][i];
        if (cur === prev) {
          run++;
          if (j === n - 1 && run >= 5) score += 3 + run - 5;
        } else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
    }
  }

  // Rule 2: 2×2 blocks of same color
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3;
    }

  // Rule 3: finder-like 1011101 with 4 light on either side
  const pat = [true, false, true, true, true, false, true];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n - 10; c++) {
      let rowHit = true, colHit = true;
      for (let k = 0; k < 7; k++) {
        if (m[r][c + k] !== pat[k]) rowHit = false;
        if (m[c + k]?.[r] !== pat[k]) colHit = false;
      }
      if (rowHit) {
        const before = c >= 4 && !m[r].slice(c - 4, c).some(Boolean);
        const after = c + 11 <= n && !m[r].slice(c + 7, c + 11).some(Boolean);
        if (before || after) score += 40;
      }
      if (colHit) {
        let before = c >= 4, after = c + 11 <= n;
        for (let k = 1; k <= 4; k++) {
          if (before && m[c - k][r]) before = false;
          if (after && m[c + 6 + k][r]) after = false;
        }
        if (before || after) score += 40;
      }
    }

  // Rule 4: dark ratio deviation from 50%
  let dark = 0;
  for (const rowArr of m) for (const v of rowArr) if (v) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;

  return score;
}

// ── Public API ────────────────────────────────────────────────────────────────
/** Encode text (ASCII/UTF-8) into a QR module matrix. Throws if > v6-H capacity. */
export function qrMatrix(text: string): boolean[][] {
  const bytes: number[] = [];
  for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0));

  let version = 0;
  for (let v = 1; v <= 6; v++) {
    // byte-mode overhead: 4-bit mode + 8-bit length (versions 1–9)
    if (bytes.length <= dataCapacity(v) - 2) { version = v; break; }
  }
  if (!version) throw new Error(`QR payload too long (${bytes.length} bytes > v6-H)`);

  const totalData = dataCapacity(version);
  const bits = new Bits();
  bits.put(0b0100, 4);            // byte mode
  bits.put(bytes.length, 8);      // char count (8 bits for v1–9 byte mode)
  for (const b of bytes) bits.put(b, 8);
  // terminator + byte alignment
  bits.put(0, Math.min(4, totalData * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.putBit(false);
  // pad codewords
  const PADS = [0xec, 0x11];
  let p = 0;
  while (bits.bytes.length < totalData) bits.put(PADS[p++ % 2], 8);

  // Split into blocks, compute EC, interleave
  const [ecLen, groups] = H_BLOCKS[version - 1];
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [cw, cnt] of groups) {
    for (let i = 0; i < cnt; i++) {
      const data = bits.bytes.slice(offset, offset + cw);
      offset += cw;
      blocks.push({ data, ec: rsEncode(data, ecLen) });
    }
  }
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const interleaved: number[] = [];
  for (let i = 0; i < maxData; i++)
    for (const b of blocks) if (i < b.data.length) interleaved.push(b.data[i]);
  for (let i = 0; i < ecLen; i++)
    for (const b of blocks) interleaved.push(b.ec[i]);

  // Pick the mask with the lowest penalty
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = buildMatrix(version, interleaved, mask);
    const s = penalty(candidate);
    if (s < bestScore) { bestScore = s; best = candidate; }
  }
  return best!;
}
