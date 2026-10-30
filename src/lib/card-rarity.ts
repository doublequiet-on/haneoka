// L3 — GEB
// Input: A card's master rarity value.
// Output: The game's rarity name (R / SR / SSR / EX / BD) used by labels and `RarityIconCenter_*` sprites.
// Pos: [Map](L2-2.md); the single rarity table for cards, rankings, gacha history and search.
// Effects/Dependencies: None.

export const CARD_RARITY_NAMES: Readonly<Record<number, string>> = { 2: "R", 3: "SR", 4: "SSR", 10: "EX", 20: "BD" };

export function cardRarityName(value: unknown): string {
  return CARD_RARITY_NAMES[Number(value)] || "";
}
