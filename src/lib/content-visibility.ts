/** The Worker supplies current site policy before any catalogue element hydrates. */
export function showRestrictedContent(): boolean {
  return typeof document !== "undefined" && document.documentElement?.dataset.contentAccess === "1";
}

/** Formal documents stay reusable until the visitor requests the wider live scope. */
export const canUseStaticCatalogScope = (): boolean => !showRestrictedContent();

export const isRestrictedContentSource = (server: string) => server !== "jp" && server !== "intl";
export function visibleContentServers<T extends string>(servers: readonly T[]): T[] {
  return servers.filter((server) => showRestrictedContent() || !isRestrictedContentSource(server));
}
