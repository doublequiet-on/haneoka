// L3 — GEB
// Input: 当前已渲染的结果卡片与冻结的图片装饰器。
// Output: 保留页面阵容、留影绑定、歌曲、成绩指标和站点标识的 PNG。
// Pos: [Map](../L2-2.md)；配队结果的只读 DOM 快照导出。
// Effects/Dependencies: 复制结果 DOM、内嵌当前图像与 SVG 图标；按需加载 html-to-image，临时节点在完成或失败后移除。
import { toCanvas } from "html-to-image";
import { canvasToPngBlob } from "../../lib/canvas-capture";
import { LazyImages } from "../ui/lazy-images";

const controls = ".tb-hit__actions, .md-accordion, .card-growth";

async function inlineIcons(root: HTMLElement, assetsBase = location.href) {
  const sprites = new Map<string, Promise<Document>>();
  for (const use of root.querySelectorAll<SVGUseElement>("svg use")) {
    const url = new URL(use.href.baseVal, assetsBase);
    const id = url.hash.slice(1);
    url.hash = "";
    let sprite = sprites.get(url.href);
    if (!sprite) {
      sprite = fetch(url, { signal: AbortSignal.timeout(15_000) })
        .then((response) => {
          if (!response.ok) throw new Error("Icon sprite unavailable");
          return response.text();
        })
        .then((text) => new DOMParser().parseFromString(text, "image/svg+xml"));
      sprites.set(url.href, sprite);
    }
    const symbol = (await sprite).getElementById(id);
    if (symbol) {
      use.closest("svg")!.setAttribute("viewBox", symbol.getAttribute("viewBox") ?? "0 0 24 24");
      use.replaceWith(...Array.from(symbol.childNodes, (child) => child.cloneNode(true)));
    } else use.remove();
  }
}

/** Capture the visible result itself, so presentation order and styling have one owner. */
export async function renderTeamResultImage(source: HTMLElement, options: { assetsBase?: string; decorate?: (card: HTMLElement) => void } = {}): Promise<Blob> {
  const width = source.getBoundingClientRect().width;
  const locale = source.lang || document.documentElement.lang;
  const result = source.cloneNode(true) as HTMLElement;
  const originals = [...source.querySelectorAll<HTMLImageElement>("img")];
  const chips = [...result.querySelectorAll<HTMLElement>(".tb-chip")];
  source.querySelectorAll<HTMLElement>(".tb-chip").forEach((chip, index) => {
    const label = chip.querySelector(".tb-chip__label");
    const value = chip.querySelector("strong");
    if (label && value && Math.abs(label.getBoundingClientRect().top - value.getBoundingClientRect().top) < 1)
      chips[index]!.style.flexWrap = "nowrap";
  });
  const images = originals.filter((image) => !image.closest(controls));
  const loader = new LazyImages();
  try {
    for (const image of images) {
      image.loading = "eager";
      if (image.dataset.src) loader.load(image);
    }
    await Promise.all(images.map((image) => image.decode()));
  } finally {
    loader.disconnect();
  }
  await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!source.isConnected) throw new DOMException("Export cancelled", "AbortError");

  const imageData = new Map<string, string>();
  const copied = [...result.querySelectorAll<HTMLImageElement>("img")];
  originals.forEach((image, index) => {
    if (image.closest(controls)) return;
    const url = image.currentSrc || image.src;
    let data = imageData.get(url);
    if (!data) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image capture unavailable");
      context.drawImage(image, 0, 0);
      data = canvas.toDataURL("image/png");
      imageData.set(url, data);
    }
    copied[index]!.src = data;
    copied[index]!.srcset = "";
    copied[index]!.loading = "eager";
    copied[index]!.classList.remove("is-error");
    copied[index]!.classList.add("is-loaded");
    copied[index]!.removeAttribute("data-src");
    copied[index]!.removeAttribute("data-loading");
  });
  result.querySelectorAll(".media-loading").forEach((frame) => frame.setAttribute("aria-busy", "false"));
  result.querySelectorAll(".media-loading__progress").forEach((progress) => progress.remove());
  result.querySelectorAll(controls).forEach((control) => control.remove());
  result.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  options.decorate?.(result);
  for (const image of result.querySelectorAll<HTMLImageElement>("img")) {
    const source = image.dataset.src || image.getAttribute("src");
    if (!source || source.startsWith("data:")) continue;
    image.crossOrigin = "anonymous"; image.loading = "eager";
    image.src = new URL(source, options.assetsBase ?? location.href).href;
    await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image capture unavailable");
    context.drawImage(image, 0, 0); image.src = canvas.toDataURL("image/png");
    image.classList.add("is-loaded"); image.removeAttribute("data-src"); image.removeAttribute("data-loading");
  }

  const stage = document.createElement("div");
  stage.className = "team-builder tb tb-result-export";
  stage.style.width = `${width + 32}px`;
  stage.lang = locale;
  stage.inert = true;
  stage.setAttribute("aria-hidden", "true");

  const brand = document.createElement("footer");
  brand.className = "row row--between row--wrap tb-result-export__brand";
  const identity = document.createElement("span");
  identity.className = "row";
  const logo = document.createElement("img");
  logo.src = new URL("/favicon.svg", options.assetsBase ?? location.href).href;
  logo.width = 36;
  logo.height = 36;
  logo.alt = "";
  const name = document.createElement("strong");
  name.textContent = "haneoka";
  identity.append(logo, name);
  const address = document.createElement("span");
  address.textContent = "https://haneoka.org";
  brand.append(identity, address);
  stage.append(result, brand);
  document.body.append(stage);
  try {
    await inlineIcons(stage, options.assetsBase);
    if (!stage.isConnected) throw new DOMException("Export cancelled", "AbortError");
    const canvas = await toCanvas(stage, {
      pixelRatio: 2,
      style: { position: "static", inset: "auto", transform: "none" },
      includeQueryParams: true,
      fetchRequestInit: { signal: AbortSignal.timeout(20_000) },
    });
    return await canvasToPngBlob(canvas);
  } finally {
    stage.remove();
  }
}
