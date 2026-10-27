import { type CrossCatalogDTO, type CrossCatalogIdentity, type OfficialCatalogServer } from "./catalog";
import { semanticOwnerKey, sourceVariantGroups, visibleSourceVariants, isFormalCatalogSource, semanticOwnersConflict, catalogSourceOrder, preferredCatalogVariant } from "./content";
import { exclusiveCatalogServer } from "./availability";
import { pinCrossCatalogValue } from "./presentation";
import { crossCatalogRowId } from "./definitions";
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const id = (row: Row): unknown => row.id ?? row._id ?? (object(row.raw) ? row.raw._id : undefined);
export interface CrossDocumentEntry {
  identity: CrossCatalogIdentity;
  exclusive: OfficialCatalogServer | null;
  sourceIds: OfficialCatalogServer[];
  variantGroups: OfficialCatalogServer[][];
  perServer: Partial<Record<OfficialCatalogServer, { identity: CrossCatalogIdentity; row: Row }>>;
}

/** Native rows retain every admitted source version beside the chosen display row. */
export function crossCatalogDocuments(dto: CrossCatalogDTO) {
  const nativeId = (row: Row) => id(row) ?? crossCatalogRowId(dto.resource, row);
  const order = catalogSourceOrder(Object.keys(dto.identities), dto.selectedServer);
  const sources = order.filter((server) => dto.documents[server] && dto.identities[server]);
  const complete = dto.sourceAvailability.jp === "loaded" && dto.sourceAvailability.intl === "loaded";
  const entries = new WeakMap<Row, CrossDocumentEntry>(), byId = new Map<string, CrossDocumentEntry>();
  const copyRows = (values: { server: OfficialCatalogServer; row: Row }[], key: string) => {
    const groups = new Map<string, typeof values>();
    for (const value of values) {
      if (!isFormalCatalogSource(value.server) && values.some(formal =>
        isFormalCatalogSource(formal.server) && !semanticOwnersConflict(formal.row, value.row, dto.resource))) continue;
      const owner = isFormalCatalogSource(value.server) ? "formal" : semanticOwnerKey(value.row, dto.resource) ?? `source:${value.server}`;
      const group = groups.get(owner) ?? [];
      group.push(value); groups.set(owner, group);
    }
    return [...groups.values()].flatMap(group => {
      const variants = visibleSourceVariants(group.map(value => ({ identity: dto.identities[value.server]!, row: value.row })), complete);
      if (!variants.length) return [];
      const primary = preferredCatalogVariant(variants, dto.selectedServer)!, copied = pinCrossCatalogValue(primary.row, primary.identity) as Row;
      const sourceIds = variants.map(variant => variant.identity.server);
      const entry: CrossDocumentEntry = { identity: primary.identity, exclusive: complete ? exclusiveCatalogServer(sourceIds) ?? null : null,
        sourceIds, variantGroups: sourceVariantGroups(variants), perServer: Object.fromEntries(variants.map(variant =>
          [variant.identity.server, { identity: variant.identity, row: pinCrossCatalogValue(variant.row, variant.identity) as Row }])) };
      entries.set(copied, entry);
      for (const source of sourceIds) byId.set(source + ':' + key, entry);
      if (!byId.has(key)) byId.set(key, entry);
      return [{ row: copied, source: primary.identity.server }];
    });
  };
  function merge(values: Partial<Record<OfficialCatalogServer, unknown>>, path: string): unknown {
    const present = sources.filter((server) => values[server] !== undefined);
    if (!present.length) return undefined;
    const primary = present[0]!, first = values[primary];
    if (Array.isArray(first)) {
      if (!first.every((row) => object(row) && nativeId(row) !== undefined))
        return pinCrossCatalogValue(first, dto.identities[primary]!);
      const maps = new Map(present.map((server) => [server, new Map((Array.isArray(values[server]) ? values[server] as Row[] : [])
        .filter((row) => object(row) && nativeId(row) !== undefined).map((row) => [String(nativeId(row)), row]))]));
      const keys = new Set(present.flatMap((server) => [...maps.get(server)!.keys()]));
      return [...keys].flatMap(key => copyRows(present.flatMap(server => {
        const row = maps.get(server)!.get(key);
        return row ? [{ server, row }] : [];
      }), key).map(value => value.row));
    }
    if (!object(first)) return first;
    const keys = new Set(present.flatMap((server) => object(values[server]) ? Object.keys(values[server]) : []));
    const rows = [...keys].every((key) => present.every((server) => {
      const row = object(values[server]) ? values[server][key] : undefined;
      return row === undefined || object(row) && nativeId(row) !== undefined;
    }));
    return Object.fromEntries([...keys].flatMap((key) => {
      const members = Object.fromEntries(present.map((server) => [server, object(values[server]) ? values[server][key] : undefined]));
      if (rows) {
        const variants = copyRows(present.flatMap(server => object(members[server]) ? [{ server, row: members[server] }] : []), key);
        return variants.map((variant, index) => [index === 0 ? key : variant.source + ':' + key, variant.row]);
      }
      return [[key, merge(members, path + '.' + key)]];
    }));
  }
  return { document: merge(dto.documents, "") as Row, entries, byId };
}
export type CrossCatalogDocuments = ReturnType<typeof crossCatalogDocuments>;
