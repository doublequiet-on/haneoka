import type { OfficialCatalogServer } from "./catalog";

/** Formal availability takes precedence over additional source presence. */
export function exclusiveCatalogServer(availability: readonly OfficialCatalogServer[]): OfficialCatalogServer | undefined {
  const jp = availability.includes("jp"), intl = availability.includes("intl");
  if (jp && intl) return undefined;
  if (jp) return "jp";
  if (intl) return "intl";
  const additional = availability.filter((server) => server !== "jp" && server !== "intl");
  return additional.length === 1 ? additional[0] : undefined;
}
