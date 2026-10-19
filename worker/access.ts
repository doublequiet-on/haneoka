import { effectiveUserRole, type MemberTier, type StoredUserRole, type UserRole } from "../src/lib/user-roles";

export type CommunityRestrictionKind = "sign_in" | "upload" | "write";

export interface CommunityAccessState {
  restriction: CommunityRestrictionKind | null;
  role: UserRole;
  status: "active" | "deleted" | "suspended";
}

interface CommunityAccessRow extends Omit<CommunityAccessState, "role"> {
  role: StoredUserRole;
  memberTier: MemberTier;
}

export const communityAccessState = async (
  env: Env,
  userId: string,
  kinds: readonly CommunityRestrictionKind[],
): Promise<CommunityAccessState | null> => {
  const restrictionSelect = kinds.length
    ? `(SELECT restriction.kind
        FROM community_user_restriction AS restriction
        WHERE restriction.user_id = profile.user_id
          AND restriction.kind IN (${kinds.map(() => "?").join(", ")})
          AND restriction.revoked_at IS NULL
          AND (restriction.expires_at IS NULL OR restriction.expires_at > ?)
        ORDER BY CASE restriction.kind WHEN 'sign_in' THEN 0 WHEN 'write' THEN 1 ELSE 2 END
        LIMIT 1)`
    : "NULL";
  const row = await env.DB.prepare(
    `SELECT profile.role, profile.member_tier AS memberTier, profile.status, ${restrictionSelect} AS restriction
     FROM community_profile AS profile
     WHERE profile.user_id = ?
     LIMIT 1`,
  )
    .bind(...kinds, ...(kinds.length ? [Date.now()] : []), userId)
    .first<CommunityAccessRow>();
  return row
    ? { restriction: row.restriction, role: effectiveUserRole(row.role, row.memberTier), status: row.status }
    : null;
};
