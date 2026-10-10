/*
Rename a coin's pool ID in Redis, e.g. after renaming coins/esf1175coin.json
to coins/elevenseventyfive.json (coin "name" esf1175coin -> elevenseventyfive).

The pool keys all Redis data by the coin name, so without this the renamed
pool starts empty and loses its blocks, pending payouts and balances.
The script renames:
- every "<old>:*" key to "<new>:*";
- the parent coins' merged-mining logs "<parent>:auxBlocks:<old>";
- the "<old>" entry in each statHistory snapshot (the history charts).

Stop the pool first (sudo systemctl stop sha256-nomp) and take a Redis
backup (redis-cli save, copy dump.rdb). Run from the pool folder:

  node scripts/rename-coin-redis.js <old> <new>            dry run, lists the changes
  node scripts/rename-coin-redis.js <old> <new> --apply    renames

Redis host/port/password come from config.json (defaultPoolConfigs.redis);
override with --host, --port, --password. Refuses to overwrite: if any
target key already exists, nothing is changed.
*/
var path = require("path");
var fs = require("fs");
var redis = require("redis");

var args = process.argv.slice(2);
var opts = {};
var positional = [];
for (var i = 0; i < args.length; i++) {
  if (args[i] === "--apply") opts.apply = true;
  else if (/^--(host|port|password)$/.test(args[i])) opts[args[i].slice(2)] = args[++i];
  else positional.push(args[i]);
}
var oldName = positional[0];
var newName = positional[1];
if (!oldName || !newName || oldName === newName || !/^[a-z0-9_-]+$/.test(oldName + newName)) {
  console.error("usage: node scripts/rename-coin-redis.js <old> <new> [--apply] [--host h] [--port p] [--password pw]");
  console.error("names are lowercase coin names, as in coins/*.json");
  process.exit(1);
}

var redisConfig = {};
try {
  var config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf8"));
  redisConfig = (config.defaultPoolConfigs && config.defaultPoolConfigs.redis) || config.redis || {};
} catch (e) {
  console.log("config.json not read (" + e.message + "), using defaults/arguments");
}
var host = opts.host || redisConfig.host || "127.0.0.1";
var port = Number(opts.port || redisConfig.port || 6379);
var password = opts.password !== undefined ? opts.password : redisConfig.password;

async function scanKeys(client, pattern) {
  var keys = [];
  var cursor = "0";
  do {
    var reply = await client.sendCommand(["SCAN", cursor, "MATCH", pattern, "COUNT", "1000"]);
    cursor = String(reply[0]);
    keys = keys.concat(reply[1].map(String));
  } while (cursor !== "0");
  return keys;
}

// glob-escape a coin name for SCAN MATCH
function glob(s) {
  return s.replace(/[*?[\]\\]/g, "\\$&");
}

async function main() {
  var client = redis.createClient({
    socket: { host: host, port: port },
    password: password || undefined,
    RESP: 2,
  });
  client.on("error", function (err) {
    console.error("Redis error:", err.message);
  });
  await client.connect();
  console.log("Redis " + host + ":" + port + " - rename coin \"" + oldName + "\" -> \"" + newName + "\"" + (opts.apply ? "" : " (dry run)"));

  // 1. <old>:* -> <new>:*
  var renames = (await scanKeys(client, glob(oldName) + ":*")).map(function (k) {
    return [k, newName + k.slice(oldName.length)];
  });
  // 2. <parent>:auxBlocks:<old> -> <parent>:auxBlocks:<new>
  (await scanKeys(client, "*:auxBlocks:" + glob(oldName))).forEach(function (k) {
    if (k.indexOf(oldName + ":") === 0) return; // already covered by 1
    renames.push([k, k.slice(0, k.length - oldName.length) + newName]);
  });

  var conflicts = [];
  for (var r of renames) {
    if (Number(await client.sendCommand(["EXISTS", r[1]]))) conflicts.push(r[1]);
  }
  if (conflicts.length) {
    console.error("Target keys already exist, nothing changed:\n  " + conflicts.slice(0, 20).join("\n  "));
    await client.quit();
    process.exit(2);
  }

  // 3. statHistory snapshots: pools.<old> -> pools.<new>
  var history = await client.sendCommand(["ZRANGE", "statHistory", "0", "-1", "WITHSCORES"]);
  var historyUpdates = [];
  for (var h = 0; h < history.length; h += 2) {
    var member = String(history[h]);
    var snap;
    try {
      snap = JSON.parse(member);
    } catch (e) {
      continue;
    }
    if (!snap.pools || !snap.pools[oldName] || snap.pools[newName]) continue;
    var pools = {};
    Object.keys(snap.pools).forEach(function (p) {
      if (p === oldName) {
        pools[newName] = Object.assign({}, snap.pools[p], { name: newName });
      } else {
        pools[p] = snap.pools[p];
      }
    });
    snap.pools = pools;
    historyUpdates.push([member, String(history[h + 1]), JSON.stringify(snap)]);
  }

  var byPrefix = {};
  renames.forEach(function (r) {
    var p = r[0].split(":").slice(0, 2).join(":");
    byPrefix[p] = (byPrefix[p] || 0) + 1;
  });
  Object.keys(byPrefix).sort().forEach(function (p) {
    console.log("  " + p + ":*  " + byPrefix[p] + " key(s)");
  });
  renames
    .filter(function (r) {
      return /:(blocksPending|blocksConfirmed|immature|balances|payouts|auxBlocks)/.test(r[0]);
    })
    .forEach(function (r) {
      console.log("  " + r[0] + " -> " + r[1]);
    });
  console.log(renames.length + " key(s) to rename, " + historyUpdates.length + " statHistory snapshot(s) to update");

  if (!opts.apply) {
    console.log("Dry run - nothing changed. Add --apply to rename.");
    await client.quit();
    return;
  }

  for (var r2 of renames) {
    var ok = await client.sendCommand(["RENAMENX", r2[0], r2[1]]);
    if (Number(ok) !== 1) console.error("  not renamed (target appeared?): " + r2[0]);
  }
  for (var u of historyUpdates) {
    await client.sendCommand(["ZREM", "statHistory", u[0]]);
    await client.sendCommand(["ZADD", "statHistory", u[1], u[2]]);
  }
  var left = await scanKeys(client, glob(oldName) + ":*");
  console.log("Done. " + renames.length + " key(s) renamed, " + historyUpdates.length + " snapshot(s) updated, " + left.length + " \"" + oldName + ":*\" key(s) left.");
  await client.quit();
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
