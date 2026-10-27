type StoryRecord = Record<string, unknown>;

export function storyCharacterIds(episode: StoryRecord): number[] {
  const birthday = episode.birthday as { characterId: number } | undefined;
  if (episode.storyCategory === "birthday" && birthday) return [Number(birthday.characterId)];
  return (
    Array.isArray(episode.characterIds) ? episode.characterIds : episode.characterId ? [episode.characterId] : []
  ).map(Number);
}
