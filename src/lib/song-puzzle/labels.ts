// L3 — GEB
// Input: 截图网格像素、裁剪及高置信视觉匹配的源位置。
// Output: 经同图字形交叉验证的编号到源位置提示。
// Pos: [Map](../L2-2.md)；可选的本地自校准编号识别。
// Effects/Dependencies: 纯像素处理；不下载字体或模型，无编号或校准不足时返回空集合。
import type { PuzzleCrop, PuzzlePixels } from "./recognition";

interface Glyph {
  x: number;
  y: number;
  width: number;
  height: number;
  bits: Uint8Array;
}
interface Anchor {
  row: number;
  source: number;
}
interface Example {
  row: number;
  digit: string;
  glyph: Glyph;
}

function components(image: PuzzlePixels, x: number, y: number, side: number, bright: boolean, cutoff: number): Glyph[] {
  const scale = Math.max(1, side / 64),
    width = Math.ceil((side * 0.72) / scale),
    height = Math.ceil((side * 0.58) / scale),
    mask = new Uint8Array(width * height),
    glyphs: Glyph[] = [];
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const px = Math.max(0, Math.min(image.width - 1, Math.round(x + (col + 0.5) * scale))),
        py = Math.max(0, Math.min(image.height - 1, Math.round(y + (row + 0.5) * scale))),
        offset = (py * image.width + px) * 4,
        r = image.data[offset] / 255,
        g = image.data[offset + 1] / 255,
        b = image.data[offset + 2] / 255,
        luma = r * 0.299 + g * 0.587 + b * 0.114;
      mask[row * width + col] = Number(
        (bright ? luma > cutoff : luma < 1 - cutoff) && Math.max(r, g, b) - Math.min(r, g, b) < 0.6,
      );
    }
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    const stack = [start],
      pixels: number[] = [];
    let left = width,
      top = height,
      right = 0,
      bottom = 0;
    mask[start] = 0;
    while (stack.length) {
      const index = stack.pop()!,
        col = index % width,
        row = Math.floor(index / width);
      pixels.push(index);
      left = Math.min(left, col);
      right = Math.max(right, col);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
      for (const next of [
        col ? index - 1 : -1,
        col < width - 1 ? index + 1 : -1,
        row ? index - width : -1,
        row < height - 1 ? index + width : -1,
        col && row ? index - width - 1 : -1,
        col < width - 1 && row ? index - width + 1 : -1,
        col && row < height - 1 ? index + width - 1 : -1,
        col < width - 1 && row < height - 1 ? index + width + 1 : -1,
      ]) {
        if (next < 0 || !mask[next]) continue;
        mask[next] = 0;
        stack.push(next);
      }
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      !left ||
      !top ||
      right === width - 1 ||
      bottom === height - 1 ||
      h < 5 ||
      h > height * 0.8 ||
      w > h * 1.2 ||
      pixels.length < h * 0.7 ||
      pixels.length > w * h * 0.95
    )
      continue;
    const original = new Uint8Array(w * h);
    for (const index of pixels) original[(Math.floor(index / width) - top) * w + (index % width) - left] = 1;
    const bits = new Uint8Array(8 * 12),
      fit = Math.max(1, Math.min(8, Math.round((w / h) * 12)));
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 8; col++) {
        const px = Math.floor(((col - (8 - fit) / 2 + 0.5) / fit) * w),
          py = Math.min(h - 1, Math.floor(((row + 0.5) / 12) * h));
        if (px >= 0 && px < w) bits[row * 8 + col] = original[py * w + px];
      }
    glyphs.push({ x: left, y: top, width: w, height: h, bits });
  }
  return glyphs;
}

function distance(a: Glyph, b: Glyph): number {
  let error = 0;
  for (let i = 0; i < a.bits.length; i++) error += Math.abs(a.bits[i] - b.bits[i]);
  return error / a.bits.length + Math.abs(a.width / a.height - b.width / b.height) * 0.12;
}

function classify(glyph: Glyph, bank: Example[], exclude = -1): { digit: string; margin: number } | undefined {
  const scores = Array.from({ length: 10 }, (_, digit) => {
    const values = bank
      .filter((example) => example.row !== exclude && example.digit === String(digit))
      .map((example) => distance(glyph, example.glyph))
      .sort((a, b) => a - b);
    return { digit: String(digit), score: values.length ? (values[0] + (values[1] ?? values[0])) / 2 : Infinity };
  }).sort((a, b) => a.score - b.score);
  if (scores[0].score > 0.24 || scores[1].score - scores[0].score < 0.018) return;
  return { digit: scores[0].digit, margin: scores[1].score - scores[0].score };
}

/** Number shapes are learned only from confident image matches and validated with each anchor left out. */
export function readPuzzleLabels(
  image: PuzzlePixels,
  size: number,
  crop: PuzzleCrop,
  gap: number,
  anchors: Anchor[],
  goal: number[],
): Map<number, number> {
  const hints = new Map<number, number>();
  if (anchors.length < 12) return hints;
  const pitch = crop.side / (size - gap),
    side = pitch * (1 - gap);
  let best: { accuracy: number; bank: Example[]; groups: Glyph[][]; values: string[] } | undefined;
  for (const bright of [true, false])
    for (const cutoff of [0.5, 0.6, 0.7]) {
      const candidates = Array.from({ length: size * size }, (_, i) =>
        components(image, crop.x + (i % size) * pitch, crop.y + Math.floor(i / size) * pitch, side, bright, cutoff),
      );
      const modes = anchors.flatMap((anchor) => candidates[anchor.row]);
      let mode: Glyph | undefined,
        support = 0;
      for (const candidate of modes) {
        const count = anchors.reduce(
          (sum, anchor) =>
            sum +
            Math.min(
              2,
              candidates[anchor.row].filter(
                (glyph) => Math.abs(glyph.y - candidate.y) <= 2 && Math.abs(glyph.height - candidate.height) <= 2,
              ).length,
            ),
          0,
        );
        if (count > support) {
          support = count;
          mode = candidate;
        }
      }
      if (!mode || support < anchors.length * 0.7) continue;
      const font = mode;
      const groups = candidates.map((list) =>
        list
          .filter((glyph) => Math.abs(glyph.y - font.y) <= 2 && Math.abs(glyph.height - font.height) <= 2)
          .sort((a, b) => a.x - b.x),
      );
      for (const values of [goal.map(String), goal.map((_, index) => String(index + 1))]) {
        const examples = anchors.filter(
          (anchor) => groups[anchor.row].length === values[anchor.source].length && groups[anchor.row].length <= 2,
        );
        if (examples.length < 12 || examples.length < anchors.length * 0.75) continue;
        const bank = examples.flatMap((anchor) =>
          groups[anchor.row].map((glyph, index) => ({ row: anchor.row, digit: values[anchor.source][index], glyph })),
        );
        if (
          Array.from(
            { length: 10 },
            (_, digit) =>
              new Set(bank.filter((example) => example.digit === String(digit)).map((example) => example.row)).size,
          ).some((count) => count < 2)
        )
          continue;
        const correct = examples.filter(
          (anchor) =>
            groups[anchor.row].map((glyph) => classify(glyph, bank, anchor.row)?.digit ?? "?").join("") ===
            values[anchor.source],
        ).length;
        const accuracy = correct / examples.length;
        if (accuracy >= 0.9 && (!best || accuracy > best.accuracy)) best = { accuracy, bank, groups, values };
      }
    }
  if (!best) return hints;
  const model = best;
  for (let row = 0; row < model.groups.length; row++) {
    const group = model.groups[row];
    if (!group.length || group.length > 2) continue;
    const digits = group.map((glyph) => classify(glyph, model.bank));
    if (digits.some((digit) => !digit)) continue;
    const value = digits.map((digit) => digit!.digit).join(""),
      source = model.values.indexOf(value);
    if (source >= 0 && goal[source] !== 0) hints.set(row, source);
  }
  const counts = new Map<number, number>();
  for (const source of hints.values()) counts.set(source, (counts.get(source) ?? 0) + 1);
  for (const [row, source] of hints) if (counts.get(source)! > 1) hints.delete(row);
  return hints;
}
