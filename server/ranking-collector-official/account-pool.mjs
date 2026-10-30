// L3 — GEB
// Input: Private T62-compatible SQLite account registry and authorized regional configurations.
// Output: Redacted management summaries, leased official queries and protected cloud configuration exports.
// Pos: [Map](../L2.md); operator CLI for the shared ranking collector.
// Effects/Dependencies: SQLite/AES-GCM, private files and a bounded Python protocol subprocess; no account login.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const roots = {
  jp: ["https://api.bang-dream-on.jp"],
  tw: ["https://l12-prod-hk-all-gs-sirius.gamerfusiontech.com", "https://l14-prod-hk-all-gs-sirius.gamerfusiontech.com"],
  en: ["https://l14-prod-va-all-gs-sirius.bilibiligame.net", "https://l17-prod-va-all-gs-sirius.bilibiligame.net"],
  kr: ["https://l14-prod-kr-all-gs-sirius.bilibiligame.net", "https://l17-prod-kr-all-gs-sirius.bilibiligame.net"],
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const now = () => Date.now();
const fail = (kind, retryAfterSeconds) => { throw Object.assign(new Error(kind), { kind, retryAfterSeconds }); };
const privateRead = (file, maximum = 65536) => {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum || process.platform !== "win32" && (info.mode & 0o077)) fail("private_file_required");
  return readFileSync(file, "utf8");
};
const privateWrite = (file, value) => {
  const descriptor = openSync(file, "wx", 0o600);
  try { writeFileSync(descriptor, JSON.stringify(value)); }
  finally { closeSync(descriptor); }
};
function configuration(value) {
  const region = value?.credentials?.region === "hk" ? "tw" : value?.credentials?.region;
  const authorization = value?.credentials;
  const credentials = authorization?.credentials;
  if (authorization?.region !== (region === "tw" ? "hk" : region)) fail("region_mismatch");
  if (!roots[region]?.includes(authorization?.origin) || !/^\d+\.\d+\.\d+$/u.test(value?.clientVersion) ||
      typeof credentials?.player_id !== "string" || !credentials.player_id ||
      typeof credentials?.credential !== "string" || !credentials.credential || !value?.masterConfig?.masterCrypto) fail("invalid_configuration");
  if (region === "jp" && credentials.bid) fail("region_mismatch");
  for (const key of ["player_id", "credential", "device_id", "bid"])
    if (credentials[key] != null && (typeof credentials[key] !== "string" || !/^[\x21-\x7e]+$/u.test(credentials[key]))) fail("invalid_credentials");
  const selected = { clientVersion: value.clientVersion, credentials: authorization, masterConfig: value.masterConfig };
  if (Buffer.byteLength(JSON.stringify(selected)) > 5120) fail("configuration_too_large");
  return { region, origin: authorization.origin, value: selected };
}

export class AccountPool {
  constructor(database, keyFile) {
    const directory = dirname(resolve(database));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32" && (lstatSync(directory).mode & 0o077)) fail("private_directory_required");
    this.key = Buffer.from(privateRead(keyFile, 128).trim(), "base64");
    if (this.key.length !== 32) fail("invalid_encryption_key");
    try {
      const info = lstatSync(database);
      if (!info.isFile() || info.isSymbolicLink() || process.platform !== "win32" && (info.mode & 0o077)) fail("private_file_required");
    }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    this.db = new DatabaseSync(database);
    chmodSync(database, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS game_query_region(region TEXT PRIMARY KEY,interval_ms INTEGER NOT NULL DEFAULT 10000,
        proxy_enabled INTEGER NOT NULL DEFAULT 0,next_request_at INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO game_query_region(region) VALUES('jp'),('tw'),('en'),('kr');
      CREATE TABLE IF NOT EXISTS game_query_account(id TEXT PRIMARY KEY,region TEXT NOT NULL REFERENCES game_query_region(region),label TEXT NOT NULL,
        source TEXT NOT NULL,client_version TEXT NOT NULL,credential_box TEXT NOT NULL,identity_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'unverified',generation TEXT NOT NULL,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
        next_request_at INTEGER NOT NULL DEFAULT 0,last_used_at INTEGER NOT NULL DEFAULT 0,last_success_at INTEGER,last_error TEXT,
        request_count INTEGER NOT NULL DEFAULT 0,failure_count INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(region,identity_hash));
      CREATE TABLE IF NOT EXISTS game_query_account_binding(account_id TEXT PRIMARY KEY REFERENCES game_query_account(id),origin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS game_query_pool_state(region TEXT PRIMARY KEY REFERENCES game_query_region(region),selected_account TEXT,
        blocked_account TEXT,blocked_generation TEXT,blocked_kind TEXT);`);
  }
  close() { this.db.close(); }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  seal(id, region, value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${id}:${region}:v1`));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
    return `v1.${iv.toString("base64")}.${body.toString("base64")}`;
  }
  unseal(row) {
    try {
      const [version, iv, text] = row.credential_box.split(".");
      if (version !== "v1") fail("credential_unreadable");
      const body = Buffer.from(text, "base64"), cipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
      cipher.setAAD(Buffer.from(`${row.id}:${row.region}:v1`));
      cipher.setAuthTag(body.subarray(-16));
      const decoded = JSON.parse(Buffer.concat([cipher.update(body.subarray(0, -16)), cipher.final()]).toString());
      const config = configuration(decoded);
      if (config.region !== row.region || config.origin !== row.origin) fail("origin_mismatch");
      return config.value;
    } catch { fail("credential_unreadable"); }
  }
  status() {
    return {
      regions: this.db.prepare(`SELECT r.region,r.interval_ms AS intervalMs,r.next_request_at AS nextRequestAt,
        s.selected_account AS selectedAccount,s.blocked_kind AS blockedKind FROM game_query_region r
        LEFT JOIN game_query_pool_state s ON s.region=r.region ORDER BY r.region`).all(),
      accounts: this.db.prepare(`SELECT a.id,a.region,a.label,a.source,a.client_version AS clientVersion,a.enabled,
        CASE WHEN b.origin IS NULL THEN 'origin_required' ELSE a.state END AS state,b.origin,
        a.lease_until AS leaseUntil,a.last_success_at AS lastSuccessAt,a.last_error AS lastError,
        a.request_count AS requestCount,a.failure_count AS failureCount,a.version FROM game_query_account a
        LEFT JOIN game_query_account_binding b ON b.account_id=a.id ORDER BY a.region,a.created_at,a.id`).all(),
    };
  }
  import(value, label, source = "import") {
    const config = configuration(value);
    if (typeof label !== "string" || !label.trim() || label.length > 100 || !["guest", "sdk", "import"].includes(source)) fail("invalid_account");
    const identity = hash(`${config.region}:${config.value.credentials.credentials.player_id}`);
    const auth = config.value.credentials.credentials;
    const generation = hash(JSON.stringify({ region: config.region, origin: config.origin, player_id: auth.player_id,
      credential: auth.credential, device_id: auth.device_id || null, bid: auth.bid || null }));
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT a.*,b.origin FROM game_query_account a LEFT JOIN game_query_account_binding b ON b.account_id=a.id WHERE a.region=? AND a.identity_hash=?").get(config.region, identity);
      if (prior?.lease_until > now()) fail("account_busy");
      if (prior?.origin && prior.origin !== config.origin) fail("origin_mismatch");
      if (prior?.generation === generation && JSON.stringify(this.unseal(prior)) === JSON.stringify(config.value)) return { accountId: prior.id, changed: false };
      const id = prior?.id || randomUUID(), timestamp = now(), box = this.seal(id, config.region, config.value);
      const preservedPause = prior?.generation === generation && ["auth_required", "device_conflict"].includes(prior.state);
      if (prior) this.db.prepare(`UPDATE game_query_account SET label=?,client_version=?,credential_box=?,generation=?,state=?,
        last_error=CASE WHEN ? THEN last_error ELSE NULL END,next_request_at=0,version=version+1,updated_at=? WHERE id=?`)
        .run(label.trim(), config.value.clientVersion, box, generation, preservedPause ? prior.state : "unverified", preservedPause ? 1 : 0, timestamp, id);
      else this.db.prepare(`INSERT INTO game_query_account(id,region,label,source,client_version,credential_box,identity_hash,generation,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, config.region, label.trim(), source, config.value.clientVersion, box, identity, generation, timestamp, timestamp);
      this.db.prepare("INSERT OR REPLACE INTO game_query_account_binding(account_id,origin) VALUES(?,?)").run(id, config.origin);
      this.db.prepare("INSERT OR IGNORE INTO game_query_pool_state(region,selected_account) VALUES(?,?)").run(config.region, id);
      this.db.prepare(`UPDATE game_query_pool_state SET blocked_account=NULL,blocked_generation=NULL,blocked_kind=NULL
        WHERE region=? AND blocked_account=? AND blocked_generation<>?`).run(config.region, id, generation);
      if (prior && prior.client_version !== config.value.clientVersion) this.db.prepare(`UPDATE game_query_pool_state
        SET blocked_account=NULL,blocked_generation=NULL,blocked_kind=NULL WHERE region=? AND blocked_account=? AND blocked_kind='version'`)
        .run(config.region, id);
      return { accountId: id, changed: true };
    });
  }
  state(id, enabled) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM game_query_account WHERE id=?").get(id);
      if (!row) fail("account_not_found");
      if (row.lease_until > now()) fail("account_busy");
      this.db.prepare("UPDATE game_query_account SET enabled=?,version=version+1,updated_at=? WHERE id=?").run(enabled ? 1 : 0, now(), id);
      return { accountId: id, enabled };
    });
  }
  select(region, id) {
    return this.transaction(() => {
      const state = this.db.prepare("SELECT * FROM game_query_pool_state WHERE region=?").get(region);
      if (state?.blocked_kind) fail(state.blocked_kind);
      const row = this.db.prepare("SELECT a.*,b.origin FROM game_query_account a JOIN game_query_account_binding b ON b.account_id=a.id WHERE a.id=? AND a.region=? AND a.enabled=1").get(id, region);
      if (!row) fail("account_not_found");
      if (!["ready", "unverified", "cooldown"].includes(row.state)) fail("account_unavailable");
      if (this.db.prepare("SELECT id FROM game_query_account WHERE region=? AND lease_until>?").get(region, now())) fail("account_busy");
      this.unseal(row);
      this.db.prepare("INSERT INTO game_query_pool_state(region,selected_account) VALUES(?,?) ON CONFLICT(region) DO UPDATE SET selected_account=excluded.selected_account").run(region, id);
      return { accountId: id, region };
    });
  }
  selected(region) {
    if (!roots[region]) fail("invalid_region");
    const state = this.db.prepare("SELECT * FROM game_query_pool_state WHERE region=?").get(region);
    if (state?.blocked_kind) fail(state.blocked_kind);
    const row = this.db.prepare(`SELECT a.*,b.origin FROM game_query_account a JOIN game_query_account_binding b ON b.account_id=a.id
      WHERE a.id=? AND a.region=? AND a.enabled=1`).get(state?.selected_account || "", region);
    if (!row || !["ready", "unverified", "cooldown"].includes(row.state)) fail("no_available_account");
    return row;
  }
  export(region, output) {
    const row = this.selected(region);
    if (row.lease_until > now()) fail("account_busy");
    if (row.state !== "ready") fail("account_not_verified");
    privateWrite(output, this.unseal(row));
    return { region, exported: true, accountId: row.id };
  }
  exportPool(region, output) {
    const selected = this.selected(region);
    const rows = this.db.prepare(`SELECT a.*,b.origin FROM game_query_account a JOIN game_query_account_binding b ON b.account_id=a.id
      WHERE a.region=? ORDER BY a.created_at,a.id`).all(region);
    if (rows.some((row) => row.lease_until > now())) fail("account_busy");
    const accounts = rows.map((row) => ({ id: row.id, label: row.label, source: row.source, enabled: row.enabled === 1,
      state: row.state, lastSuccessAtMs: row.last_success_at, ...this.unseal(row) }));
    const config = { contract: "haneoka:official-ranking-account-pool/1", region, selectedAccountId: selected.id, accounts };
    if (Buffer.byteLength(JSON.stringify(config)) > 5120) fail("configuration_too_large");
    privateWrite(output, config);
    return { region, exported: true, accounts: accounts.length, selectedAccountId: selected.id };
  }
  lease(region) {
    return this.transaction(() => {
      const row = this.selected(region), timestamp = now();
      const policy = this.db.prepare("SELECT * FROM game_query_region WHERE region=?").get(region);
      if (row.lease_until > timestamp) fail("account_busy");
      const next = Math.max(row.next_request_at, policy.next_request_at);
      if (next > timestamp) fail("cooldown", Math.ceil((next - timestamp) / 1000));
      const config = this.unseal(row), token = randomUUID();
      this.db.prepare("UPDATE game_query_region SET next_request_at=? WHERE region=?").run(timestamp + policy.interval_ms, region);
      this.db.prepare(`UPDATE game_query_account SET lease_token=?,lease_until=?,last_used_at=?,request_count=request_count+1 WHERE id=?`).run(token, timestamp + 60000, timestamp, row.id);
      return { row, config, token };
    });
  }
  finish(lease, outcome) {
    return this.transaction(() => {
      const { row, token } = lease, timestamp = now();
      const blocked = ["authentication", "device_conflict", "version"].includes(outcome.kind);
      const state = outcome.ok ? "ready" : outcome.kind === "authentication" ? "auth_required" : blocked ? outcome.kind : "cooldown";
      const result = this.db.prepare(`UPDATE game_query_account SET state=?,last_error=?,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,
        failure_count=failure_count+?,lease_token=NULL,lease_until=0,next_request_at=?,updated_at=? WHERE id=? AND lease_token=? AND generation=?`)
        .run(state, outcome.ok ? null : outcome.kind, outcome.ok ? 1 : 0, timestamp, outcome.ok ? 0 : 1,
          timestamp + (outcome.ok ? 1000 : Math.max(10000, outcome.retryAfterSeconds * 1000 || 60000)), timestamp, row.id, token, row.generation);
      if (result.changes !== 1) fail("session_changed");
      if (blocked) this.db.prepare(`UPDATE game_query_pool_state SET blocked_account=?,blocked_generation=?,blocked_kind=? WHERE region=?`)
        .run(row.id, row.generation, outcome.kind, row.region);
      if (!outcome.ok) this.db.prepare("UPDATE game_query_region SET next_request_at=MAX(next_request_at,?) WHERE region=?")
        .run(timestamp + Math.max(10000, outcome.retryAfterSeconds * 1000 || 60000), row.region);
    });
  }
  async query(region, kind, id, python, proxy, output) {
    if (typeof output !== "string" || !output || !["challenge", "total"].includes(kind) || !/^[1-9][0-9]{0,18}$/u.test(id) || BigInt(id) > 9223372036854775807n) fail("invalid_query");
    const lease = this.lease(region);
    let outcome;
    try {
      outcome = await new Promise((resolveResult) => {
        const child = spawn(python, [join(dirname(fileURLToPath(import.meta.url)), "core/pool_query.py")], {
          stdio: ["pipe", "pipe", "ignore"], timeout: 55000,
        });
        const chunks = []; let length = 0;
        child.stdout.on("data", (chunk) => { length += chunk.length; if (length > 2 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
        child.on("error", () => resolveResult({ ok: false, kind: "runtime_unavailable" }));
        child.on("close", () => {
          try { resolveResult(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { resolveResult({ ok: false, kind: "query_interrupted" }); }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify({ region, kind, id, config: lease.config, proxy }));
      });
    } finally { this.finish(lease, outcome || { ok: false, kind: "query_interrupted" }); }
    if (!outcome.ok) fail(outcome.kind, outcome.retryAfterSeconds);
    privateWrite(output, outcome.result);
    return { ...outcome.result.meta, accountId: lease.row.id, players: outcome.result.data.players.length, saved: true };
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2), args = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index].startsWith("--") || rest[index + 1] === undefined) fail("invalid_arguments");
    args[rest[index].slice(2)] = rest[index + 1];
  }
  const directory = args.directory;
  if (!directory || !["status", "import", "pause", "enable", "select", "query", "export", "export-pool"].includes(command)) fail("invalid_arguments");
  const pool = new AccountPool(join(directory, "pool-local.sqlite"), args.key || join(directory, "pool-encryption-key"));
  try {
    let result;
    if (command === "status") result = pool.status();
    else if (command === "import") result = pool.import(JSON.parse(privateRead(args.config, 5120)), args.label, args.source);
    else if (command === "pause" || command === "enable") result = pool.state(args.account, command === "enable");
    else if (command === "select") result = pool.select(args.region, args.account);
    else if (command === "export") result = pool.export(args.region, args.output);
    else if (command === "export-pool") result = pool.exportPool(args.region, args.output);
    else result = await pool.query(args.region, args.kind, args.id, args.python || "python3", args.proxy || "", args.output);
    console.log(JSON.stringify(result));
  } finally { pool.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(JSON.stringify({ error: error.kind || "pool_unavailable", ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) })); process.exitCode = 1; });
}
