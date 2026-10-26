// L3 — GEB
// Input: 本次截图、封面像素、阶数、裁剪、可选目标空格与请求令牌。
// Output: 相同令牌的布局识别结果或匹配失败。
// Pos: [Map](../L2.md)；按需启动的拼图图像处理 Worker。
// Effects/Dependencies: CPU 本地识别；宿主在重试、取消和离开时终止实例。
import { recognizePuzzle, type PuzzlePixels, type PuzzleCrop } from "../lib/song-puzzle/recognition";

self.onmessage = ({
  data,
}: MessageEvent<{
  token: number;
  image: PuzzlePixels;
  cover: PuzzlePixels;
  size: number;
  crop?: PuzzleCrop;
  goalBlank?: number;
}>) => {
  try {
    self.postMessage({
      token: data.token,
      result: recognizePuzzle(data.image, data.cover, data.size, data.crop, data.goalBlank),
    });
  } catch {
    self.postMessage({ token: data.token, error: true });
  }
};
