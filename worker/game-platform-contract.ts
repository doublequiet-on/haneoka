// L3 — GEB
// Input: 游戏资源、参数与 protobuf JSON 契约。
// Output: 羽丘游戏 API 路由及响应 schema。
// Pos: [Map](L2.md)；实时游戏 API 契约。
// Effects/Dependencies: 纯数据。
export const GAME_PLATFORM_ROUTES = [
  {
    "path": "/api/v1/players/{profileId}",
    "upstreamPath": "/profile/{profileId}",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "profileId",
        "upstreamName": "profileId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.friend.FindByProfileIDResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/players",
    "upstreamPath": "/profiles",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "accountId",
        "upstreamName": "accountIds",
        "in": "query",
        "required": true,
        "schema": {
          "items": {
            "pattern": "^-?[0-9]+$",
            "type": "string"
          },
          "maxItems": 100,
          "minItems": 1,
          "type": "array"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.playerext.GetPlayerListResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/players/favorites",
    "upstreamPath": "/player/{playerId}/favorites",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "accountId",
        "upstreamName": "playerId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.player.GetPlayerFavoriteStatusResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/players/{profileId}/cards/{page}.png",
    "upstreamPath": "/profile/{profileId}/card/{page}",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "profileId",
        "upstreamName": "profileId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "page",
        "upstreamName": "page",
        "in": "path",
        "required": true,
        "schema": {
          "minimum": 1,
          "type": "integer"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "image/png": {
            "schema": {
              "format": "binary",
              "type": "string"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/songs/{songId}/ranking",
    "upstreamPath": "/music/{musicId}/ranking",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "songId",
        "upstreamName": "musicId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.livemusic.GetRankingResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/events/{eventId}/ranking",
    "upstreamPath": "/event/ranking",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "eventId",
        "upstreamName": "eventId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "rank",
        "upstreamName": "ranks",
        "in": "query",
        "required": true,
        "schema": {
          "items": {
            "type": "integer"
          },
          "maxItems": 100,
          "minItems": 1,
          "type": "array"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.event.GetRankingListResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/events/challenges/{challengeId}/ranking",
    "upstreamPath": "/event/challenge/{challengeMusicId}/ranking",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "challengeId",
        "upstreamName": "challengeMusicId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.event.GetChallengeMusicRankingResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/events/{eventId}/decks/{accountId}",
    "upstreamPath": "/event/{eventId}/deck/{playerId}",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "accountId",
        "upstreamName": "playerId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "eventId",
        "upstreamName": "eventId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.event.GetDeckResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/arena/seasons/{seasonId}/ranking",
    "upstreamPath": "/arena/ranking",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "seasonId",
        "upstreamName": "arenaSeasonId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "bandId",
        "upstreamName": "bandId",
        "in": "query",
        "required": false,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "start",
        "upstreamName": "rankingStart",
        "in": "query",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "end",
        "upstreamName": "rankingEnd",
        "in": "query",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.arena.ArenaRankingResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/arena/seasons/{seasonId}/songs/{songId}/decks",
    "upstreamPath": "/arena/{arenaSeasonId}/music/{musicId}/deck-trend",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "songId",
        "upstreamName": "musicId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "seasonId",
        "upstreamName": "arenaSeasonId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.arena.DeckTrendResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/circles/{circleId}",
    "upstreamPath": "/circle/{circleId}",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "circleId",
        "upstreamName": "circleId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.circle.GetCircleResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/circles",
    "upstreamPath": "/circles/search",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "name",
        "upstreamName": "options.name",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "memberRange",
        "upstreamName": "options.memberRange",
        "in": "query",
        "required": false,
        "schema": {
          "oneOf": [
            {
              "enum": [
                "MEMBER_RANGE_UNSPECIFIED",
                "MEMBER_RANGE_1",
                "MEMBER_RANGE_2",
                "MEMBER_RANGE_3"
              ],
              "type": "string"
            },
            {
              "format": "int32",
              "type": "integer"
            }
          ]
        }
      },
      {
        "name": "joinRule",
        "upstreamName": "options.joinRule",
        "in": "query",
        "required": false,
        "schema": {
          "oneOf": [
            {
              "enum": [
                "JOIN_RULE_UNSPECIFIED",
                "AUTO",
                "REQUEST",
                "INVITE"
              ],
              "type": "string"
            },
            {
              "format": "int32",
              "type": "integer"
            }
          ]
        }
      },
      {
        "name": "playStyle",
        "upstreamName": "options.playStyle",
        "in": "query",
        "required": false,
        "schema": {
          "oneOf": [
            {
              "enum": [
                "PLAY_STYLE_UNSPECIFIED",
                "FREE",
                "CASUAL",
                "HARD",
                "BEGINNER"
              ],
              "type": "string"
            },
            {
              "format": "int32",
              "type": "integer"
            }
          ]
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.circle.SearchResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/gacha/{gachaId}/rates",
    "upstreamPath": "/gacha/{gachaId}/rates",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "gachaId",
        "upstreamName": "gachaId",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "productId",
        "upstreamName": "productId",
        "in": "query",
        "required": false,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      },
      {
        "name": "pickupId",
        "upstreamName": "selectedPickUp",
        "in": "query",
        "required": false,
        "schema": {
          "items": {
            "pattern": "^-?[0-9]+$",
            "type": "string"
          },
          "maxItems": 100,
          "type": "array"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.gacha.ProbabilityResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/announcements/views/live",
    "upstreamPath": "/announcements",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "category",
        "upstreamName": "selectedTab",
        "in": "query",
        "required": false,
        "schema": {
          "oneOf": [
            {
              "enum": [
                "ALL",
                "OPENING_EVENTS",
                "BUG"
              ],
              "type": "string"
            },
            {
              "format": "int32",
              "type": "integer"
            }
          ]
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.announcement.GetListResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  },
  {
    "path": "/api/v1/announcements/{announcementId}/live",
    "upstreamPath": "/announcement/{id}",
    "parameters": [
      {
        "name": "region",
        "upstreamName": "region",
        "in": "query",
        "required": true,
        "schema": {
          "enum": [
            "tw",
            "jp",
            "en",
            "kr"
          ],
          "type": "string"
        }
      },
      {
        "name": "announcementId",
        "upstreamName": "id",
        "in": "path",
        "required": true,
        "schema": {
          "pattern": "^-?[0-9]+$",
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/app.announcement.GetResponse"
            }
          }
        }
      },
      "400": {},
      "401": {},
      "403": {},
      "404": {},
      "405": {},
      "429": {},
      "502": {},
      "503": {},
      "504": {}
    }
  }
] as const;
export const GAME_PLATFORM_SCHEMAS = {
  "app.announcement.GetListResponse": {
    "additionalProperties": true,
    "properties": {
      "announcements": {
        "items": {
          "$ref": "#/components/schemas/entity.Announcement"
        },
        "type": "array"
      },
      "externalContents": {
        "items": {
          "$ref": "#/components/schemas/entity.AnnouncementExternalContent"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.announcement.GetResponse": {
    "additionalProperties": true,
    "properties": {
      "announcement": {
        "$ref": "#/components/schemas/entity.Announcement"
      }
    },
    "type": "object"
  },
  "app.arena.ArenaRankingResponse": {
    "additionalProperties": true,
    "properties": {
      "maxRank": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "ranking": {
        "items": {
          "$ref": "#/components/schemas/entity.ArenaRankingEntry"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.arena.DeckTrendResponse": {
    "additionalProperties": true,
    "properties": {
      "leaders": {
        "items": {
          "$ref": "#/components/schemas/entity.ArenaDeckTrendMemberCard"
        },
        "type": "array"
      },
      "members": {
        "items": {
          "$ref": "#/components/schemas/entity.ArenaDeckTrendMemberCard"
        },
        "type": "array"
      },
      "supports": {
        "items": {
          "$ref": "#/components/schemas/entity.ArenaDeckTrendSupportCard"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.circle.GetCircleResponse": {
    "additionalProperties": true,
    "properties": {
      "circle": {
        "$ref": "#/components/schemas/entity.CircleDetailWithPlayerList"
      }
    },
    "type": "object"
  },
  "app.circle.SearchResponse": {
    "additionalProperties": true,
    "properties": {
      "circles": {
        "items": {
          "$ref": "#/components/schemas/entity.CircleWithMasterPlayer"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.event.ChallengeLiveRankingPlayer": {
    "additionalProperties": true,
    "properties": {
      "highScoreDeck": {
        "$ref": "#/components/schemas/entity.DeckDetail"
      },
      "playerData": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      },
      "score": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "app.event.EventRankingEntry": {
    "additionalProperties": true,
    "properties": {
      "point": {
        "type": "integer"
      },
      "profile": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      },
      "rank": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "app.event.GetChallengeMusicRankingResponse": {
    "additionalProperties": true,
    "properties": {
      "players": {
        "items": {
          "$ref": "#/components/schemas/app.event.ChallengeLiveRankingPlayer"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.event.GetDeckResponse": {
    "additionalProperties": true,
    "properties": {
      "deck": {
        "$ref": "#/components/schemas/entity.DeckDetail"
      }
    },
    "type": "object"
  },
  "app.event.GetRankingListResponse": {
    "additionalProperties": true,
    "properties": {
      "ranking": {
        "items": {
          "$ref": "#/components/schemas/app.event.EventRankingEntry"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.friend.FindByProfileIDResponse": {
    "additionalProperties": true,
    "properties": {
      "playerProfile": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      }
    },
    "type": "object"
  },
  "app.gacha.ProbabilityResponse": {
    "additionalProperties": true,
    "properties": {
      "ensuredLot": {
        "items": {
          "$ref": "#/components/schemas/entity.LotProbability"
        },
        "type": "array"
      },
      "ensuredPrize": {
        "items": {
          "$ref": "#/components/schemas/entity.PrizeProbability"
        },
        "type": "array"
      },
      "ensuredProducts": {
        "additionalProperties": {
          "type": "integer"
        },
        "type": "object"
      },
      "lot": {
        "items": {
          "$ref": "#/components/schemas/entity.LotProbability"
        },
        "type": "array"
      },
      "prize": {
        "items": {
          "$ref": "#/components/schemas/entity.PrizeProbability"
        },
        "type": "array"
      },
      "probabilities": {
        "additionalProperties": {
          "$ref": "#/components/schemas/entity.Probability"
        },
        "type": "object"
      },
      "products": {
        "additionalProperties": {
          "type": "integer"
        },
        "type": "object"
      }
    },
    "type": "object"
  },
  "app.livemusic.GetRankingResponse": {
    "additionalProperties": true,
    "properties": {
      "players": {
        "items": {
          "$ref": "#/components/schemas/app.livemusic.LiveRankingPlayer"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "app.livemusic.LiveRankingPlayer": {
    "additionalProperties": true,
    "properties": {
      "highScoreDeck": {
        "$ref": "#/components/schemas/entity.DeckDetail"
      },
      "playerData": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      },
      "score": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "app.player.GetPlayerFavoriteStatusResponse": {
    "additionalProperties": true,
    "properties": {
      "totalFavorite": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      }
    },
    "type": "object"
  },
  "app.playerext.GetPlayerListResponse": {
    "additionalProperties": true,
    "properties": {
      "players": {
        "items": {
          "$ref": "#/components/schemas/entity.PlayerBriefInfo"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "entity.Announcement": {
    "additionalProperties": true,
    "properties": {
      "bannerPath": {
        "type": "string"
      },
      "bannerUrl": {
        "type": "string"
      },
      "body": {
        "type": "string"
      },
      "category": {
        "oneOf": [
          {
            "enum": [
              "UNSPECIFIED",
              "OTHER",
              "EVENT",
              "GACHA",
              "CAMPAIGN",
              "UPDATE",
              "MAINTENANCE",
              "BUG"
            ],
            "type": "string"
          },
          {
            "format": "int32",
            "type": "integer"
          }
        ]
      },
      "endAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "id": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "lastUpdatedAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "pickupBannerPath": {
        "type": "string"
      },
      "pickupBannerUrl": {
        "type": "string"
      },
      "pickupEndAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "pickupStartAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "sortOrder": {
        "type": "integer"
      },
      "startAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "stylesheetId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.AnnouncementExternalContent": {
    "additionalProperties": true,
    "properties": {
      "bannerPath": {
        "type": "string"
      },
      "id": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.ArenaDeckTrendMemberCard": {
    "additionalProperties": true,
    "properties": {
      "memberCardId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.ArenaDeckTrendSupportCard": {
    "additionalProperties": true,
    "properties": {
      "supportCardId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.ArenaRankingEntry": {
    "additionalProperties": true,
    "properties": {
      "deck": {
        "$ref": "#/components/schemas/entity.DeckDetail"
      },
      "point": {
        "type": "integer"
      },
      "profile": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      },
      "rank": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.Circle": {
    "additionalProperties": true,
    "properties": {
      "currentRank": {
        "type": "integer"
      },
      "id": {
        "pattern": "^[0-9]+$",
        "type": "string"
      },
      "joinRule": {
        "type": "integer"
      },
      "masterLastLoginAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "memberCount": {
        "type": "integer"
      },
      "name": {
        "type": "string"
      },
      "nextRankPoint": {
        "type": "integer"
      },
      "playStyle": {
        "type": "integer"
      },
      "totalPoint": {
        "type": "integer"
      },
      "weeklyTotalPoint": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.CircleDetailWithPlayerList": {
    "additionalProperties": true,
    "properties": {
      "circleRanking": {
        "type": "integer"
      },
      "detail": {
        "$ref": "#/components/schemas/entity.Circle"
      },
      "players": {
        "items": {
          "$ref": "#/components/schemas/entity.CirclePlayer"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "entity.CirclePlayer": {
    "additionalProperties": true,
    "properties": {
      "auth": {
        "type": "integer"
      },
      "circleId": {
        "pattern": "^[0-9]+$",
        "type": "string"
      },
      "playerId": {
        "type": "string"
      },
      "point": {
        "type": "integer"
      },
      "profile": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      },
      "weeklyTotalPoint": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.CircleWithMasterPlayer": {
    "additionalProperties": true,
    "properties": {
      "circle": {
        "$ref": "#/components/schemas/entity.Circle"
      },
      "profile": {
        "$ref": "#/components/schemas/entity.PlayerSimpleProfile"
      }
    },
    "type": "object"
  },
  "entity.DeckCardDetail": {
    "additionalProperties": true,
    "properties": {
      "memberCard": {
        "$ref": "#/components/schemas/entity.DeckMemberCardDetail"
      },
      "performanceOrderIndex": {
        "type": "integer"
      },
      "slotIndex": {
        "type": "integer"
      },
      "supportCard": {
        "$ref": "#/components/schemas/entity.DeckSupportCardDetail"
      }
    },
    "type": "object"
  },
  "entity.DeckDetail": {
    "additionalProperties": true,
    "properties": {
      "cards": {
        "items": {
          "$ref": "#/components/schemas/entity.DeckCardDetail"
        },
        "type": "array"
      },
      "id": {
        "type": "integer"
      },
      "name": {
        "type": "string"
      },
      "totalPower": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.DeckMemberCardDetail": {
    "additionalProperties": true,
    "properties": {
      "awakeCount": {
        "type": "integer"
      },
      "cardId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "cardRank": {
        "type": "integer"
      },
      "exp": {
        "type": "integer"
      },
      "liveSkillLevel": {
        "type": "integer"
      },
      "performanceSkillLevel": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.DeckSupportCardDetail": {
    "additionalProperties": true,
    "properties": {
      "cardId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "exp": {
        "type": "integer"
      },
      "rank": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.LotProbability": {
    "additionalProperties": true,
    "properties": {
      "lotId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "probabilityPercent": {
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.PlayerBriefInfo": {
    "additionalProperties": true,
    "properties": {
      "accountId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "avatarId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "chatBubbleId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "chatFrameId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "chatThemeId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "level": {
        "type": "integer"
      },
      "nickname": {
        "type": "string"
      },
      "playerId": {
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.PlayerSimpleProfile": {
    "additionalProperties": true,
    "properties": {
      "favoriteMemberCard": {
        "$ref": "#/components/schemas/entity.DeckMemberCardDetail"
      },
      "favoriteMemberCardMasterId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "id": {
        "type": "string"
      },
      "lastUpdatedAt": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "profileCard": {
        "$ref": "#/components/schemas/entity.SimpleProfileCard"
      },
      "profileId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "rankExp": {
        "type": "integer"
      }
    },
    "type": "object"
  },
  "entity.PrizeProbability": {
    "additionalProperties": true,
    "properties": {
      "prizeId": {
        "pattern": "^-?[0-9]+$",
        "type": "string"
      },
      "probabilityPercent": {
        "type": "string"
      }
    },
    "type": "object"
  },
  "entity.Probability": {
    "additionalProperties": true,
    "properties": {
      "lot": {
        "items": {
          "$ref": "#/components/schemas/entity.LotProbability"
        },
        "type": "array"
      },
      "prize": {
        "items": {
          "$ref": "#/components/schemas/entity.PrizeProbability"
        },
        "type": "array"
      }
    },
    "type": "object"
  },
  "entity.SimpleProfileCard": {
    "additionalProperties": true,
    "properties": {
      "name": {
        "type": "string"
      },
      "slot": {
        "type": "integer"
      },
      "thumbnailUrl": {
        "items": {
          "type": "string"
        },
        "type": "array"
      }
    },
    "type": "object"
  }
} as const;
