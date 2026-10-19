// L3 — GEB
// Input: 内部 SQL 表别名与共享 staff 角色注册表。
// Output: 兼容物理角色与会员等级的有效身份 SQL 表达式。
// Pos: [Map](L2.md)；账户读取与管理筛选共用的 SQL 规则。
// Effects/Dependencies: 无 I/O；表别名来自调用方内部常量。

import { STAFF_ROLES } from "../src/lib/user-roles";

const staffRolesSql = STAFF_ROLES.map((role) => `'${role}'`).join(",");

/** The alias is an internal SQL identifier, never request input. */
export const effectiveUserRoleSql = (alias: string): string =>
  `(CASE WHEN ${alias}.role IN (${staffRolesSql}) THEN ${alias}.role ELSE ${alias}.member_tier END)`;
