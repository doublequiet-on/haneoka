// L3 — GEB
// Input: 服务器与固定 release 的目录、UI 图集。
// Output: 最高分评级门槛、游戏段位徽章和阶段星地址。
// Pos: [Map](L2-2.md)；最高分评级页与静态输入准备共用的数据读取器。
// Effects/Dependencies: 构建期固定版本读取，登记捕获／重放输入；不向页面嵌入完整图集。
import { fetchStaticCatalog, staticCatalogRelease } from "../lib/static-catalog-source";
import type { ReleaseServer } from "../lib/release-server";

interface Rating {
  raw: { _bandId?: number; _grade: number; _step: number; _rating: number };
}

export async function highScoreRatingPageData(server: ReleaseServer) {
  const release = await staticCatalogRelease(server);
  const [ratingData, atlasData] = await Promise.all([
    fetchStaticCatalog("live-tools", server, release),
    fetchStaticCatalog("sources/Assets/AddressableResources/UI/Atlas/FixUiSpriteAtlas.spriteatlasv2", server, release),
  ]);
  const ratings = ratingData as {
    bandHighScoreRatings: Rating[];
    totalHighScoreRatings: Rating[];
  };
  const atlas = atlasData as { outputs: Array<{ path: string; type: string }> };
  const sprites = new Map(
    atlas.outputs
      .filter((output) => output.type === "Sprite")
      .map((output) => [
        output.path
          .split("/")
          .at(-1)!
          .replace(/--Sprite-?-?\d+\.png$/u, ""),
        `/runtime/${server}/${output.path.replace(/^runtime\//u, "")}?release=${release.releaseId}`,
      ]),
  );
  return { ratings, sprites };
}
