// L3 — GEB
// Input: Current selector, descriptor fetches and a view's staged synchronous commit.
// Output: Verified whole-view replacement after a final current-version check.
// Pos: [Map](L2-2.md); cancellable catalogue snapshot refresh.
// Effects/Dependencies: Bounded HTTP reads; the host controls visibility and polling.
import {
  PAGE_CONTRACT,
  PAGE_MAX_BYTES,
  canonicalPageJson,
  pageDigest,
  pageRecord,
  validPageRef,
  validatePageEnvelope,
  validPageSelector,
  type PageDescriptor,
  type PageSelector,
  type PageEnvelope,
} from "./catalog-page-contract";
import { validateChartPage, type ChartPageData } from "./catalog-page-computed";

async function boundedJson(response: Response, expectedBytes?: number): Promise<{ value: unknown; body: Uint8Array }> {
  if (!response.ok || !response.body) throw new Error(`page-data HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > (expectedBytes ?? PAGE_MAX_BYTES)) throw new Error("page-data byte limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (expectedBytes !== undefined && size !== expectedBytes) throw new Error("page-data size mismatch");
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { value: JSON.parse(new TextDecoder().decode(body)), body };
}

export class CatalogPageRefresh {
  private task = 0;
  private abort?: AbortController;
  private adopted?: string;
  private computation?: string;
  constructor(
    private readonly host: {
      selector(): PageSelector | undefined;
      location?(): string;
      active(): boolean;
      fetch(input: string, init: RequestInit): Promise<Response>;
      prepare(page: PageEnvelope): Promise<() => void>;
      absent(): void;
      computed?(state: "pending" | "ready", value?: ChartPageData): void;
      report(state: "pending" | "unchanged" | "updated" | "absent" | "error", error?: unknown): void;
    },
  ) {}
  cancel(): void {
    this.task++;
    this.abort?.abort();
  }
  private markAbsent(): void {
    this.adopted = undefined;
    this.computation = undefined;
    this.host.absent();
    this.host.report("absent");
  }
  async check(): Promise<void> {
    this.cancel();
    const sequence = this.task;
    const selector = this.host.selector();
    if (!selector || !validPageSelector(selector) || !this.host.active()) return;
    const selected = canonicalPageJson(selector);
    const location = this.host.location?.();
    const controller = (this.abort = new AbortController());
    const current = () =>
      sequence === this.task &&
      !controller.signal.aborted &&
      this.host.active() &&
      this.host.location?.() === location &&
      canonicalPageJson(this.host.selector() ?? null) === selected;
    const get = async (url: string, bytes?: number) => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      const response = await this.host.fetch(url, {
        signal,
        cache: "no-cache",
        headers: { accept: "application/json" },
      });
      if (response.status === 404) {
        const error = await response.json();
        if (error?.error === "entity_absent") return { absent: true as const };
      }
      return boundedJson(response, bytes);
    };
    const params = new URLSearchParams({
      projection: "page-data",
      contract: PAGE_CONTRACT,
      locale: selector.locale,
      resource: selector.resource,
      ...(selector.id === undefined ? {} : { id: selector.id }),
    });
    const url = `/api/v1/servers/${selector.server}/release?${params}`;
    const adoptComputed = async (descriptor: PageDescriptor) => {
      if (!this.host.computed || selector.resource !== "songs") return;
      const computed = descriptor.computed.chartRates;
      if (computed.state !== "ready") {
        this.host.computed("pending");
        return;
      }
      if (!validPageRef(computed.page) || !computed.page.url?.startsWith(`/api/v1/servers/${selector.server}/`))
        throw new Error("Invalid chart reference");
      if (this.computation === computed.page.sha256) return;
      const fetched = await get(computed.page.url, computed.page.bytes);
      if ("absent" in fetched || (await pageDigest(fetched.body)) !== computed.page.sha256)
        throw new Error("Chart reference hash mismatch");
      const source = descriptor.resourceVector.find((row) => row.server === selector.server);
      if (source?.state !== "published") throw new Error("Missing computed source pin");
      const pin = { server: source.server, releaseId: source.releaseId, sourceId: source.sourceId };
      const table = validateChartPage(fetched.value, pin, {
        engineCommit: computed.engineCommit,
        computationRecipe: computed.recipe,
      });
      const latest = await get(url);
      if (!current() || "absent" in latest) return;
      const check = latest.value as PageDescriptor;
      if (
        check.state !== "ready" ||
        check.snapshotId !== descriptor.snapshotId ||
        check.computed?.chartRates.state !== "ready" ||
        check.computed.chartRates.page.sha256 !== computed.page.sha256
      )
        return;
      this.host.computed("ready", table);
      this.computation = computed.page.sha256;
    };
    try {
      const first = await get(url);
      if (!current()) return;
      if ("absent" in first) {
        this.markAbsent();
        return;
      }
      if (pageRecord(first.value) && first.value.state === "pending") {
        this.host.report("pending");
        return;
      }
      const descriptor = first.value as PageDescriptor;
      if (
        !pageRecord(descriptor) ||
        descriptor.state !== "ready" ||
        !validPageRef(descriptor.page) ||
        canonicalPageJson(descriptor.selector) !== selected ||
        typeof descriptor.page.url !== "string" ||
        !descriptor.page.url.startsWith(`/api/v1/servers/${selector.server}/`)
      )
        throw new Error("page-data descriptor mismatch");
      const identity = `${descriptor.snapshotId}:${descriptor.page.sha256}`;
      if (identity === this.adopted) {
        await adoptComputed(descriptor);
        this.host.report("unchanged");
        return;
      }
      const fetched = await get(descriptor.page.url, descriptor.page.bytes);
      if ("absent" in fetched || (await pageDigest(fetched.body)) !== descriptor.page.sha256)
        throw new Error("page-data hash mismatch");
      const page = await validatePageEnvelope(fetched.value, descriptor, selector);
      const commit = await this.host.prepare(page);
      if (!current()) return;
      const latest = await get(url);
      if (!current()) return;
      if ("absent" in latest) {
        this.markAbsent();
        return;
      }
      if (
        !pageRecord(latest.value) ||
        latest.value.state !== "ready" ||
        latest.value.snapshotId !== descriptor.snapshotId ||
        !pageRecord(latest.value.page) ||
        latest.value.page.sha256 !== descriptor.page.sha256
      )
        return;
      commit();
      this.adopted = identity;
      this.computation = undefined;
      this.host.report("updated");
      await adoptComputed(descriptor);
    } catch (error) {
      if (current()) this.host.report("error", error);
    }
  }
}
