// L3 — GEB
// Input: Release-pinned character voice entries from official servers.
// Output: A character voice archive with shared translations and preferred recordings.
// Pos: [Map](L2-2.md); character voice association and source provenance.
// Effects/Dependencies: Pure projection; uses the shared catalogue source order and owner identity.
import { catalogSourceOrder, semanticOwnerKey } from "./content";

type Row = Record<string, unknown>;
export interface VoiceSnapshot {
  identity: { server: string; releaseId: string; sourceId: string };
  entries: Row[];
}
const object = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const lines = (entry: Row): Row[] => (Array.isArray(entry.lines) ? (entry.lines as Row[]) : [entry]);
const japanese = (value: unknown): string =>
  Array.isArray(value)
    ? String(value[0] || "")
        .normalize("NFKC")
        .replace(/\s+/gu, " ")
        .trim()
    : "";
const text = (primary: unknown, peer: unknown): unknown => {
  if (!Array.isArray(primary) || !Array.isArray(peer)) return primary || peer;
  if (japanese(primary) && japanese(peer) && japanese(primary) !== japanese(peer)) return primary;
  return primary.map((value, index) => value || peer[index] || "");
};
export function preferredVoiceRecordings(entries: readonly Row[]): Row[] {
  return entries.map((entry) => {
    if (!Array.isArray(entry.recordings) || !entry.recordings.length) return entry;
    const { recordings, ...base } = entry;
    return { ...base, ...(recordings as Row[])[0] };
  });
}
function sameRecording(left: Row, right: Row): boolean {
  const a = lines(left),
    b = lines(right);
  if (a.length !== b.length) return false;
  return a.every((line, index) => {
    const other = b[index]!;
    if (line.characterId !== other.characterId) return false;
    if (japanese(line.text) && japanese(other.text) && japanese(line.text) !== japanese(other.text)) return false;
    const sound = object(line.sound),
      peer = object(other.sound);
    if (!sound.playableUrl || !peer.playableUrl) return true;
    return typeof sound.sha256 === "string" && sound.sha256 === peer.sha256;
  });
}
function pin(entry: Row, snapshot: VoiceSnapshot): Row {
  const sound = (value: unknown): Row => {
    const result = { ...object(value) };
    if (typeof result.playableUrl === "string" && result.playableUrl.startsWith("/")) {
      const url = new URL(result.playableUrl, "https://resource.invalid");
      url.searchParams.set("release", snapshot.identity.releaseId);
      result.playableUrl = url.pathname + url.search;
    }
    return result;
  };
  return {
    ...entry,
    ...(Array.isArray(entry.lines)
      ? { lines: (entry.lines as Row[]).map((line) => ({ ...line, sound: sound(line.sound) })) }
      : { sound: sound(entry.sound) }),
    sourceServer: snapshot.identity.server,
    sourceServers: [snapshot.identity.server],
    sourceIdentities: { [snapshot.identity.server]: { ...snapshot.identity } },
  };
}

export function mergeCharacterVoices(snapshots: readonly VoiceSnapshot[], selected: string): Record<string, Row> {
  const order = catalogSourceOrder(
    snapshots.map((snapshot) => snapshot.identity.server),
    selected,
  );
  const groups = new Map<string, Row[]>();
  for (const server of order) {
    const snapshot = snapshots.find((value) => value.identity.server === server)!;
    for (const original of preferredVoiceRecordings(snapshot.entries)) {
      const entry = pin(original, snapshot);
      const key = JSON.stringify([
        original.voiceKey,
        original.voiceGroup,
        original.voiceKind,
        semanticOwnerKey(original, "voices"),
      ]);
      const variants = groups.get(key) || [];
      const existing = variants.find((value) => sameRecording(value, entry));
      if (!existing) variants.push(entry);
      else {
        const primary = existing;
        const peer = entry;
        const merged: Row = { ...primary, text: text(primary.text, peer.text), title: text(primary.title, peer.title) };
        if (Array.isArray(primary.lines))
          merged.lines = lines(primary).map((line, index) => {
            const other = lines(peer)[index]!;
            return {
              ...line,
              text: text(line.text, other.text),
              sound: object(line.sound).playableUrl ? line.sound : other.sound,
            };
          });
        else if (!object(primary.sound).playableUrl) merged.sound = peer.sound;
        merged.sourceServers = [...new Set([...(existing.sourceServers as string[]), server])];
        merged.sourceIdentities = { ...object(existing.sourceIdentities), ...object(entry.sourceIdentities) };
        variants[variants.indexOf(existing)] = merged;
      }
      groups.set(key, variants);
    }
  }
  const result: Record<string, Row> = {};
  for (const variants of groups.values())
    for (const entry of variants) {
      const key = String(entry.voiceKey) + ":" + (entry.sourceServers as string[]).slice().sort().join("-");
      result[key] = { ...entry, voiceKey: key };
    }
  return result;
}
