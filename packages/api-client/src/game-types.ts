// L3 — GEB
// Input: 游戏 protobuf JSON 字段契约。
// Output: 保留十进制字符串 ID 和省略字段的响应类型。
// Pos: [Map](../../L2.md)；实时游戏响应类型。
// Effects/Dependencies: 仅类型；兼容新增响应字段。
export type AppAnnouncementGetListResponse = { readonly "announcements"?: readonly (EntityAnnouncement)[]; readonly "externalContents"?: readonly (EntityAnnouncementExternalContent)[]; readonly [key: string]: unknown; };
export type AppAnnouncementGetResponse = { readonly "announcement"?: EntityAnnouncement; readonly [key: string]: unknown; };
export type AppArenaArenaRankingResponse = { readonly "maxRank"?: string; readonly "ranking"?: readonly (EntityArenaRankingEntry)[]; readonly [key: string]: unknown; };
export type AppArenaDeckTrendResponse = { readonly "leaders"?: readonly (EntityArenaDeckTrendMemberCard)[]; readonly "members"?: readonly (EntityArenaDeckTrendMemberCard)[]; readonly "supports"?: readonly (EntityArenaDeckTrendSupportCard)[]; readonly [key: string]: unknown; };
export type AppCircleGetCircleResponse = { readonly "circle"?: EntityCircleDetailWithPlayerList; readonly [key: string]: unknown; };
export type AppCircleSearchResponse = { readonly "circles"?: readonly (EntityCircleWithMasterPlayer)[]; readonly [key: string]: unknown; };
export type AppEventChallengeLiveRankingPlayer = { readonly "highScoreDeck"?: EntityDeckDetail; readonly "playerData"?: EntityPlayerSimpleProfile; readonly "score"?: number; readonly [key: string]: unknown; };
export type AppEventEventRankingEntry = { readonly "point"?: number; readonly "profile"?: EntityPlayerSimpleProfile; readonly "rank"?: number; readonly [key: string]: unknown; };
export type AppEventGetChallengeMusicRankingResponse = { readonly "players"?: readonly (AppEventChallengeLiveRankingPlayer)[]; readonly [key: string]: unknown; };
export type AppEventGetDeckResponse = { readonly "deck"?: EntityDeckDetail; readonly [key: string]: unknown; };
export type AppEventGetRankingListResponse = { readonly "ranking"?: readonly (AppEventEventRankingEntry)[]; readonly [key: string]: unknown; };
export type AppFriendFindByProfileIDResponse = { readonly "playerProfile"?: EntityPlayerSimpleProfile; readonly [key: string]: unknown; };
export type AppGachaProbabilityResponse = { readonly "ensuredLot"?: readonly (EntityLotProbability)[]; readonly "ensuredPrize"?: readonly (EntityPrizeProbability)[]; readonly "ensuredProducts"?: {  readonly [key: string]: number; }; readonly "lot"?: readonly (EntityLotProbability)[]; readonly "prize"?: readonly (EntityPrizeProbability)[]; readonly "probabilities"?: {  readonly [key: string]: EntityProbability; }; readonly "products"?: {  readonly [key: string]: number; }; readonly [key: string]: unknown; };
export type AppLivemusicGetRankingResponse = { readonly "players"?: readonly (AppLivemusicLiveRankingPlayer)[]; readonly [key: string]: unknown; };
export type AppLivemusicLiveRankingPlayer = { readonly "highScoreDeck"?: EntityDeckDetail; readonly "playerData"?: EntityPlayerSimpleProfile; readonly "score"?: number; readonly [key: string]: unknown; };
export type AppPlayerGetPlayerFavoriteStatusResponse = { readonly "totalFavorite"?: string; readonly [key: string]: unknown; };
export type AppPlayerextGetPlayerListResponse = { readonly "players"?: readonly (EntityPlayerBriefInfo)[]; readonly [key: string]: unknown; };
export type EntityAnnouncement = { readonly "bannerPath"?: string; readonly "bannerUrl"?: string; readonly "body"?: string; readonly "category"?: "UNSPECIFIED" | "OTHER" | "EVENT" | "GACHA" | "CAMPAIGN" | "UPDATE" | "MAINTENANCE" | "BUG" | number; readonly "endAt"?: string; readonly "id"?: string; readonly "lastUpdatedAt"?: string; readonly "pickupBannerPath"?: string; readonly "pickupBannerUrl"?: string; readonly "pickupEndAt"?: string; readonly "pickupStartAt"?: string; readonly "sortOrder"?: number; readonly "startAt"?: string; readonly "stylesheetId"?: string; readonly [key: string]: unknown; };
export type EntityAnnouncementExternalContent = { readonly "bannerPath"?: string; readonly "id"?: string; readonly [key: string]: unknown; };
export type EntityArenaDeckTrendMemberCard = { readonly "memberCardId"?: string; readonly [key: string]: unknown; };
export type EntityArenaDeckTrendSupportCard = { readonly "supportCardId"?: string; readonly [key: string]: unknown; };
export type EntityArenaRankingEntry = { readonly "deck"?: EntityDeckDetail; readonly "point"?: number; readonly "profile"?: EntityPlayerSimpleProfile; readonly "rank"?: number; readonly [key: string]: unknown; };
export type EntityCircle = { readonly "currentRank"?: number; readonly "id"?: string; readonly "joinRule"?: number; readonly "masterLastLoginAt"?: string; readonly "memberCount"?: number; readonly "name"?: string; readonly "nextRankPoint"?: number; readonly "playStyle"?: number; readonly "totalPoint"?: number; readonly "weeklyTotalPoint"?: number; readonly [key: string]: unknown; };
export type EntityCircleDetailWithPlayerList = { readonly "circleRanking"?: number; readonly "detail"?: EntityCircle; readonly "players"?: readonly (EntityCirclePlayer)[]; readonly [key: string]: unknown; };
export type EntityCirclePlayer = { readonly "auth"?: number; readonly "circleId"?: string; readonly "playerId"?: string; readonly "point"?: number; readonly "profile"?: EntityPlayerSimpleProfile; readonly "weeklyTotalPoint"?: number; readonly [key: string]: unknown; };
export type EntityCircleWithMasterPlayer = { readonly "circle"?: EntityCircle; readonly "profile"?: EntityPlayerSimpleProfile; readonly [key: string]: unknown; };
export type EntityDeckCardDetail = { readonly "memberCard"?: EntityDeckMemberCardDetail; readonly "performanceOrderIndex"?: number; readonly "slotIndex"?: number; readonly "supportCard"?: EntityDeckSupportCardDetail; readonly [key: string]: unknown; };
export type EntityDeckDetail = { readonly "cards"?: readonly (EntityDeckCardDetail)[]; readonly "id"?: number; readonly "name"?: string; readonly "totalPower"?: number; readonly [key: string]: unknown; };
export type EntityDeckMemberCardDetail = { readonly "awakeCount"?: number; readonly "cardId"?: string; readonly "cardRank"?: number; readonly "exp"?: number; readonly "liveSkillLevel"?: number; readonly "performanceSkillLevel"?: number; readonly [key: string]: unknown; };
export type EntityDeckSupportCardDetail = { readonly "cardId"?: string; readonly "exp"?: number; readonly "rank"?: number; readonly [key: string]: unknown; };
export type EntityLotProbability = { readonly "lotId"?: string; readonly "probabilityPercent"?: string; readonly [key: string]: unknown; };
export type EntityPlayerBriefInfo = { readonly "accountId"?: string; readonly "avatarId"?: string; readonly "chatBubbleId"?: string; readonly "chatFrameId"?: string; readonly "chatThemeId"?: string; readonly "level"?: number; readonly "nickname"?: string; readonly "playerId"?: string; readonly [key: string]: unknown; };
export type EntityPlayerSimpleProfile = { readonly "favoriteMemberCard"?: EntityDeckMemberCardDetail; readonly "favoriteMemberCardMasterId"?: string; readonly "id"?: string; readonly "lastUpdatedAt"?: string; readonly "name"?: string; readonly "profileCard"?: EntitySimpleProfileCard; readonly "profileId"?: string; readonly "rankExp"?: number; readonly [key: string]: unknown; };
export type EntityPrizeProbability = { readonly "prizeId"?: string; readonly "probabilityPercent"?: string; readonly [key: string]: unknown; };
export type EntityProbability = { readonly "lot"?: readonly (EntityLotProbability)[]; readonly "prize"?: readonly (EntityPrizeProbability)[]; readonly [key: string]: unknown; };
export type EntitySimpleProfileCard = { readonly "name"?: string; readonly "slot"?: number; readonly "thumbnailUrl"?: readonly (string)[]; readonly [key: string]: unknown; };
