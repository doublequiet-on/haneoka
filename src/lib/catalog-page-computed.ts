// L3 — GEB
// Input: Exact release/engine/recipe identity and immutable computed objects.
// Output: Validated chart-rate readiness independent of core snapshots.
// Pos: [Map](L2-2.md); chart computation receipt contract.
// Effects/Dependencies: Caller-supplied content-addressed reads and conditional creates.
import {
  PAGE_CONTRACT,
  PageDataError,
  chartPageReadyKey,
  pageRecord,
  validPageRef,
  readPageObject,
  pageBlobKey,
  pageDigest,
  canonicalPageJson,
  type PageProducer,
  type PageRef,
} from "./catalog-page-contract";
type Pin = { server: string; releaseId: string; sourceId: string };
export interface ChartPageData {
  schema: "catalog-chart-rates-v1";
  pin: Pin;
  engineCommit: string;
  recipe: string;
  table: Record<string, unknown>;
}
export function validateChartPage(
  value: unknown,
  pin: Pin,
  producer: Pick<PageProducer, "engineCommit" | "computationRecipe">,
): ChartPageData {
  if (
    !pageRecord(value) ||
    value.schema !== "catalog-chart-rates-v1" ||
    canonicalPageJson(value.pin) !== canonicalPageJson(pin) ||
    value.engineCommit !== producer.engineCommit ||
    value.recipe !== producer.computationRecipe ||
    !pageRecord(value.table) ||
    value.table.sourceId !== pin.sourceId ||
    value.table.releaseId !== pin.releaseId ||
    value.table.engineCommit !== producer.engineCommit ||
    value.table.schema !== "haneoka-chart-rates-v6" ||
    !pageRecord(value.table.charts)
  )
    throw new PageDataError("page_data_incomplete", 503);
  return value as unknown as ChartPageData;
}
export async function readChartPage(
  read: (key: string) => Promise<Uint8Array | null>,
  pin: Pin,
  producer: Pick<PageProducer, "engineCommit" | "computationRecipe">,
): Promise<PageRef | undefined> {
  const body = await read(chartPageReadyKey(pin, producer));
  if (!body) return undefined;
  let receipt: unknown;
  try {
    receipt = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new PageDataError("page_data_incomplete", 503);
  }
  if (
    !pageRecord(receipt) ||
    receipt.contract !== PAGE_CONTRACT ||
    canonicalPageJson(receipt.pin) !== canonicalPageJson(pin) ||
    receipt.engineCommit !== producer.engineCommit ||
    receipt.recipe !== producer.computationRecipe ||
    !validPageRef(receipt.page)
  )
    throw new PageDataError("page_data_incomplete", 503);
  return receipt.page;
}
export async function publishChartPage(
  store: { read(key: string): Promise<Uint8Array | null>; create(key: string, body: Uint8Array): Promise<void> },
  pin: Pin,
  producer: Pick<PageProducer, "engineCommit" | "computationRecipe">,
  table: unknown,
): Promise<void> {
  const value = validateChartPage(
    {
      schema: "catalog-chart-rates-v1",
      pin,
      engineCommit: producer.engineCommit,
      recipe: producer.computationRecipe,
      table,
    },
    pin,
    producer,
  );
  const body = new TextEncoder().encode(canonicalPageJson(value));
  const page = { sha256: await pageDigest(body), bytes: body.length };
  if (!validPageRef(page)) throw new PageDataError("page_data_incomplete", 503);
  await store.create(pageBlobKey(page), body);
  validateChartPage(await readPageObject(store.read.bind(store), page), pin, producer);
  const receipt = {
    contract: PAGE_CONTRACT,
    pin,
    engineCommit: producer.engineCommit,
    recipe: producer.computationRecipe,
    page,
  };
  await store.create(chartPageReadyKey(pin, producer), new TextEncoder().encode(canonicalPageJson(receipt)));
}
