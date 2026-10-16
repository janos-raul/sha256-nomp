var execFile = require("child_process").execFile;

// Publishes this thread's live stratum connections of one pool to Redis
// (<coin>:workerConns, field "<forkId>:<subscriptionId>" -> JSON) for the
// miner page: shares since connect (accepted / stale / rejected) and the
// TCP round-trip time the kernel measures for the socket (ss -ti), so the
// miner needs no ping support. stats.js reads the hash; entries not
// refreshed within a few intervals are ignored there.
var INTERVAL_MS = 30000;

// "[::ffff:1.2.3.4]:3333" / "1.2.3.4:3333" -> { host: "1.2.3.4", port: "3333" }
function splitHostPort(s) {
  var i = s.lastIndexOf(":");
  if (i < 0) return null;
  return { host: normalizeHost(s.slice(0, i).replace(/^\[|\]$/g, "")), port: s.slice(i + 1) };
}

function normalizeHost(h) {
  h = String(h || "");
  return h.indexOf("::ffff:") === 0 ? h.slice(7) : h;
}

// localPort|peerHost|peerPort -> rtt in ms, for every established TCP socket
function readRtts(done) {
  execFile("ss", ["-tinH", "state", "established"], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, function (err, out) {
    if (err) return done(err, {});
    var rtts = {};
    var key = null;
    String(out).split("\n").forEach(function (line) {
      if (!line.trim()) return;
      if (!/^\s/.test(line)) {
        // Recv-Q Send-Q Local:Port Peer:Port
        var cols = line.trim().split(/\s+/);
        var local = cols.length >= 4 && splitHostPort(cols[2]);
        var peer = cols.length >= 4 && splitHostPort(cols[3]);
        key = local && peer ? local.port + "|" + peer.host + "|" + peer.port : null;
        return;
      }
      var m = key && /\brtt:([\d.]+)\//.exec(line);
      if (m) rtts[key] = parseFloat(m[1]);
      key = null;
    });
    done(null, rtts);
  });
}

module.exports = function (logger, poolOptions, pool, redisClient) {
  var coin = poolOptions.coin.name;
  var forkId = process.env.forkId || "0";
  var hashKey = coin + ":workerConns";
  var prefix = forkId + ":";
  var ssFailed = false;

  function publish() {
    var server = pool.stratumServer;
    if (!server || !redisClient) return;
    readRtts(function (err, rtts) {
      if (err && !ssFailed) {
        logger.warning("WorkerConns", coin, "Thread " + (parseInt(forkId) + 1), "Ping (ss -ti) unavailable: " + err.message);
      }
      ssFailed = !!err;

      var clients = server.getStratumClients();
      var now = Date.now();
      var fields = {};
      Object.keys(clients).forEach(function (subId) {
        var c = clients[subId];
        if (!c || !c.authorized || !c.workerName || !c.shareStats || !c.socket) return;
        var rtt = rtts[c.socket.localPort + "|" + normalizeHost(c.remoteAddress) + "|" + c.socket.remotePort];
        fields[prefix + subId] = JSON.stringify({
          w: String(c.workerName).replace(/:/g, "-"),
          solo: !!c.isSoloMining,
          since: c.connectedAt,
          a: c.shareStats.accepted,
          s: c.shareStats.stale,
          r: c.shareStats.rejected,
          rtt: typeof rtt === "number" ? Math.round(rtt * 10) / 10 : null,
          t: now,
        });
      });

      // Drop this thread's fields for closed connections (and leftovers of
      // an earlier run of this thread), then write the live ones
      redisClient.hkeys(hashKey, function (err, keys) {
        if (err) return;
        var gone = (keys || []).filter(function (k) {
          return k.indexOf(prefix) === 0 && !(k in fields);
        });
        var cmds = [];
        if (gone.length) cmds.push(["hdel", hashKey].concat(gone));
        var flat = [];
        Object.keys(fields).forEach(function (k) {
          flat.push(k, fields[k]);
        });
        if (flat.length) cmds.push(["hset", hashKey].concat(flat));
        if (cmds.length) redisClient.multi(cmds).exec(function () {});
      });
    });
  }

  setTimeout(publish, 10000);
  setInterval(publish, INTERVAL_MS);
};
