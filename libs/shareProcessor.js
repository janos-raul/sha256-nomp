var redis = require("./redisCompat.js"); // node-redis 6 with the v3 callback API

/*
Enhanced share processor with comprehensive logging for SHA256-NOMP
Handles both POOL and SOLO mining with proper separation and tracking
*/

module.exports = function (logger, poolConfig) {
  var redisConfig = poolConfig.redis;
  var coin = poolConfig.coin.name;
  var forkId = process.env.forkId;

  function formatCompactNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);

    var sign = n < 0 ? "-" : "";
    n = Math.abs(n);

    var units = ["", "K", "M", "G", "T", "P", "E"];
    var unitIndex = 0;
    while (n >= 1000 && unitIndex < units.length - 1) {
      n /= 1000;
      unitIndex++;
    }

    return sign + n.toFixed(2) + units[unitIndex];
  }

  // Merged mining: aux coin symbols per port ("S256+ESF"), for ports with an
  // auxGroup. A solo share on such a port means the miner merge-mines those
  // coins; the tag is appended to the solo hashrate entry for the website.
  var auxSymbolsByPort = (function () {
    var out = {};
    var mm = poolConfig.mergedMining;
    if (!mm || mm.enabled !== true || !mm.groups || !mm.auxCoins) return out;
    Object.keys(poolConfig.ports || {}).forEach(function (port) {
      var members = mm.groups[poolConfig.ports[port].auxGroup] || [];
      var symbols = members.map(function (aux) {
        return ((mm.auxCoins[aux] && mm.auxCoins[aux].symbol) || aux).toUpperCase();
      });
      if (symbols.length) out[port] = symbols.join("+");
    });
    return out;
  })();

  var logSystem = "ShareProcessor";
  var logComponent = coin;
  var logSubCat = "Thread " + (parseInt(forkId) + 1);

  // Statistics tracking
  var stats = {
    shares: { pool: 0, solo: 0, invalid: 0 },
    blocks: { pool: 0, solo: 0, orphaned: 0 },
    workers: new Map(), // Changed to Map to track timestamps
    lastBlock: null,
    startTime: Date.now(),
  };

  // Performance tracking
  var perfStats = {
    redisWrites: 0,
    redisErrors: 0,
    avgProcessTime: 0,
    totalProcessTime: 0,
    processCount: 0,
    lastReset: Date.now(),
  };

  var connection = redis.createClient({
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
  });

  connection.on("ready", function () {
    logger.success(
      logSystem,
      logComponent,
      logSubCat,
      "Share processor connected to Redis at " +
        redisConfig.host +
        ":" +
        redisConfig.port,
    );

    // Get initial stats from Redis
    loadInitialStats();
  });

  connection.on("error", function (err) {
    perfStats.redisErrors++;
    logger.error(
      logSystem,
      logComponent,
      logSubCat,
      "Redis error (#" + perfStats.redisErrors + "): " + JSON.stringify(err),
    );
  });

  connection.on("end", function () {
    logger.error(
      logSystem,
      logComponent,
      logSubCat,
      "Redis connection lost - shares may not be recorded!",
    );
  });

  connection.on("reconnecting", function () {
    logger.warning(
      logSystem,
      logComponent,
      logSubCat,
      "Attempting to reconnect to Redis...",
    );
  });

  // Redis version check with enhanced logging
  connection.info(function (error, response) {
    if (error) {
      logger.error(
        logSystem,
        logComponent,
        logSubCat,
        "Redis version check failed: " + error.message,
      );
      return;
    }

    var parts = response.split("\r\n");
    var version;
    var versionString;
    var memoryUsed;
    var connectedClients;

    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(":") !== -1) {
        var valParts = parts[i].split(":");
        switch (valParts[0]) {
          case "redis_version":
            versionString = valParts[1];
            version = parseFloat(versionString);
            break;
          case "used_memory_human":
            memoryUsed = valParts[1];
            break;
          case "connected_clients":
            connectedClients = valParts[1];
            break;
        }
      }
    }

    if (!version) {
      logger.error(
        logSystem,
        logComponent,
        logSubCat,
        "Could not detect Redis version - may be incompatible",
      );
    } else if (version < 2.6) {
      logger.error(
        logSystem,
        logComponent,
        logSubCat,
        "Redis version " +
          versionString +
          " detected - minimum required is 2.6!",
      );
    } else {
      logger.info(
        logSystem,
        logComponent,
        logSubCat,
        "Redis v" +
          versionString +
          " - Memory: " +
          memoryUsed +
          ", Clients: " +
          connectedClients,
      );
    }
  });

  // Load initial statistics from Redis
  function loadInitialStats() {
    connection
      .multi([
        ["hget", coin + ":stats", "validBlocks"],
        ["hget", coin + ":stats:solo", "validBlocks"],
        ["scard", coin + ":blocksPending"],
        ["scard", coin + ":blocksPending:solo"],
        ["scard", coin + ":activeMiners"],
      ])
      .exec(function (err, replies) {
        if (!err && replies) {
          var poolBlocks = parseInt(replies[0]) || 0;
          var soloBlocks = parseInt(replies[1]) || 0;
          var pendingPool = parseInt(replies[2]) || 0;
          var pendingSolo = parseInt(replies[3]) || 0;
          var activeMiners = parseInt(replies[4]) || 0;

          logger.info(
            logSystem,
            logComponent,
            logSubCat,
            "Loaded stats - Pool blocks: " +
              poolBlocks +
              " (pending: " +
              pendingPool +
              "), Solo blocks: " +
              soloBlocks +
              " (pending: " +
              pendingSolo +
              "), Active miners: " +
              activeMiners,
          );
        }
      });
  }

  // Merged mining (solo miners only). Every aux block is logged in
  // <coin>:auxBlocks:<auxcoin>. An accepted block whose finder gave an
  // address for that coin is also recorded as a solo block in the aux
  // coin's own keys, exactly as its own pool records one, so the aux coin's
  // payment processor pays the finder (minus its solo fee). Without an
  // address the reward stays in the pool wallet.
  // Shared with workerConns.js (same Redis as this pool's shares)
  this.redis = connection;

  this.handleAuxBlock = function (accepted, auxData) {
    var auxCoin = auxData.coin;
    var logKey = coin + ":auxBlocks:" + auxCoin;
    var dateNow = Date.now();
    var workerName = (auxData.worker || "").split(".")[1] || "default";
    var paid = accepted && auxData.auxAddress && auxData.txHash;
    var auxWorker = paid ? auxData.auxAddress + "." + workerName : null;

    var redisCommands = [
      [
        "lpush",
        logKey,
        JSON.stringify({
          time: dateNow,
          accepted: accepted,
          error: auxData.error || null,
          height: auxData.auxHeight,
          hash: auxData.auxHash,
          txHash: auxData.txHash || null,
          reward: auxData.auxCoinbaseValue,
          parentHash: auxData.parentHash,
          parentHeight: auxData.parentHeight,
          worker: auxData.worker,
          auxAddress: auxData.auxAddress || null,
          paidToFinder: !!paid,
          shareDiff: auxData.shareDiff,
        }),
      ],
      ["ltrim", logKey, 0, 999],
    ];

    if (paid) {
      redisCommands.push(
        [
          "sadd",
          auxCoin + ":blocksPending:solo",
          [auxData.auxHash, auxData.txHash, auxData.auxHeight, auxWorker, dateNow].join(":"),
        ],
        ["hset", auxCoin + ":shares:round" + auxData.auxHeight + ":solo", auxWorker, "1"],
        ["hset", auxCoin + ":shares:times" + auxData.auxHeight, auxData.auxAddress, "1"],
        ["hincrby", auxCoin + ":stats:solo", "validBlocks", 1],
        ["hincrby", auxCoin + ":stats", "validBlocks", 1],
        ["hincrby", auxCoin + ":workers:solo:" + auxWorker, "blocks", 1],
        ["hset", auxCoin + ":lastBlock:solo", "height", auxData.auxHeight],
        ["hset", auxCoin + ":lastBlock:solo", "worker", auxWorker],
        ["hset", auxCoin + ":lastBlock:solo", "time", dateNow],
      );
    }

    // network diff of the aux chain, as its payment processor last cached it
    // (refreshed every ~58 s), for the block's share / network diff display
    var netDiffReplyIndex = redisCommands.length;
    redisCommands.push(["hget", auxCoin + ":stats", "networkDiff"]);

    connection.multi(redisCommands).exec(function (err, replies) {
      if (err) {
        perfStats.redisErrors++;
        logger.error(
          logSystem,
          logComponent,
          logSubCat,
          "Error recording aux block " + auxData.auxHash + ": " + JSON.stringify(err),
        );
        return;
      }
      perfStats.redisWrites++;
      // Merged blocks have no round of their own: diffs only, no effort
      if (accepted && auxData.auxHash) {
        connection.hset(
          auxCoin + ":blockEffort",
          auxData.auxHash,
          JSON.stringify({
            shareDiff: parseFloat(auxData.shareDiff) || null,
            netDiff: parseFloat(replies && replies[netDiffReplyIndex]) || null,
            effort: null,
            minerEffort: null,
          }),
          function () {},
        );
      }
      if (paid) {
        logger.info(
          logSystem,
          logComponent,
          logSubCat,
          "Aux block " + auxData.auxHash + " queued for " + auxCoin +
            " solo payout to " + auxData.auxAddress,
        );
      }
    });
  };

  this.handleShare = function (isValidShare, isValidBlock, shareData) {
    var processStart = Date.now();
    var redisCommands = [];
    var dateNow = Date.now();

    // Get solo flag from shareData (set by poolWorker)
    var isSoloMining = shareData.isSoloMining || false;

    // Parse worker information
    var workerAddress = shareData.worker;
    var workerAddressParts = workerAddress.split(".");
    var minerAddress = workerAddressParts[0];
    var workerName = workerAddressParts[1] || "default";

    // Track unique workers with timestamp
    stats.workers.set(workerAddress, dateNow);

    // Log share processing start
    logger.debug(
      logSystem,
      logComponent,
      logSubCat,
      "Processing " +
        (isSoloMining ? "SOLO" : "POOL") +
        " share from " +
        workerAddress +
        " - Valid: " +
        isValidShare +
        ", Block: " +
        isValidBlock +
        ", Diff: " +
        formatCompactNumber(shareData.difficulty),
    );

    // Reply positions of the counters a found block reads its effort from
    var effortReplyIndex = -1;
    var minerRoundReplyIndex = -1;

    if (isValidShare) {
      // Pool effort: work from every miner (pool + solo) since the pool's
      // last block of any kind, reset in the same MULTI when a block is found
      effortReplyIndex = redisCommands.length;
      redisCommands.push([
        "incrbyfloat",
        coin + ":shares:effortCurrent",
        shareData.difficulty,
      ]);

      if (isSoloMining) {
        // SOLO MINING SHARES
        stats.shares.solo++;

        // Solo round shares
        minerRoundReplyIndex = redisCommands.length;
        redisCommands.push([
          "hincrbyfloat",
          coin + ":shares:roundCurrent:solo",
          shareData.worker,
          shareData.difficulty,
        ]);
        redisCommands.push(["hincrby", coin + ":stats:solo", "validShares", 1]);

        // Solo worker tracking with detailed stats
        redisCommands.push([
          "hincrbyfloat",
          coin + ":workers:solo:" + workerAddress,
          "shares",
          shareData.difficulty,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:solo:" + workerAddress,
          "lastShare",
          dateNow,
        ]);
        redisCommands.push([
          "hincrby",
          coin + ":workers:solo:" + workerAddress,
          "validShares",
          1,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:solo:" + workerAddress,
          "minerAddress",
          minerAddress,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:solo:" + workerAddress,
          "workerName",
          workerName,
        ]);

        // Solo hashrate tracking (4th field: merged aux coins, if any)
        var hashrateData = [shareData.difficulty, shareData.worker, dateNow];
        if (auxSymbolsByPort[shareData.port]) hashrateData.push(auxSymbolsByPort[shareData.port]);
        redisCommands.push([
          "zadd",
          coin + ":hashrate:solo",
          (dateNow / 1000) | 0,
          hashrateData.join(":"),
        ]);
        // Track round time for solo workers
        redisCommands.push([
          "hset",
          coin + ":shares:timesCurrent:solo",
          shareData.worker,
          (dateNow / 1000) | 0,
        ]);
        // Track last share difficulty for solo workers
        // (shareDiff = actual computed difficulty of this share, i.e. the
        // luck factor — not shareData.difficulty, which is just the
        // miner's assigned/target diff and barely changes between shares)
        redisCommands.push([
          "hset",
          coin + ":shares:diffCurrent:solo",
          shareData.worker,
          shareData.shareDiff || shareData.difficulty,
        ]);
        // Track best share difficulty this round (solo) — atomic GT, race-safe
        redisCommands.push([
          "zadd",
          coin + ":shares:bestDiff:solo",
          "GT",
          shareData.shareDiff || shareData.difficulty,
          shareData.worker,
        ]);
        // Log solo share
        if (stats.shares.solo % 100 === 0) {
          logger.info(
            logSystem,
            logComponent,
            logSubCat,
            "[SOLO Milestone] " + stats.shares.solo + " solo shares processed",
          );
        }
      } else {
        // POOL MINING SHARES
        stats.shares.pool++;

        // Pool round shares
        redisCommands.push([
          "hincrbyfloat",
          coin + ":shares:roundCurrent",
          shareData.worker,
          shareData.difficulty,
        ]);
        redisCommands.push(["hincrby", coin + ":stats", "validShares", 1]);

        // Pool worker tracking with detailed stats
        redisCommands.push([
          "hincrbyfloat",
          coin + ":workers:" + workerAddress,
          "shares",
          shareData.difficulty,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:" + workerAddress,
          "lastShare",
          dateNow,
        ]);
        redisCommands.push([
          "hincrby",
          coin + ":workers:" + workerAddress,
          "validShares",
          1,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:" + workerAddress,
          "minerAddress",
          minerAddress,
        ]);
        redisCommands.push([
          "hset",
          coin + ":workers:" + workerAddress,
          "workerName",
          workerName,
        ]);

        // Pool hashrate tracking
        var hashrateData = [shareData.difficulty, shareData.worker, dateNow];
        redisCommands.push([
          "zadd",
          coin + ":hashrate",
          (dateNow / 1000) | 0,
          hashrateData.join(":"),
        ]);
        // Track round time for pool workers
        redisCommands.push([
          "hset",
          coin + ":shares:timesCurrent",
          shareData.worker,
          (dateNow / 1000) | 0,
        ]);
        // Track last share difficulty for pool workers
        // (shareDiff = actual computed difficulty of this share, i.e. the
        // luck factor — not shareData.difficulty, which is just the
        // miner's assigned/target diff and barely changes between shares)
        redisCommands.push([
          "hset",
          coin + ":shares:diffCurrent",
          shareData.worker,
          shareData.shareDiff || shareData.difficulty,
        ]);
        // Track best share difficulty this round (pool) — atomic GT, race-safe
        redisCommands.push([
          "zadd",
          coin + ":shares:bestDiff",
          "GT",
          shareData.shareDiff || shareData.difficulty,
          shareData.worker,
        ]);
        // Log pool share milestones
        if (stats.shares.pool % 1000 === 0) {
          logger.info(
            logSystem,
            logComponent,
            logSubCat,
            "[POOL Milestone] " + stats.shares.pool + " pool shares processed",
          );
        }
      }

      // Track active miners (both solo and pool)
      redisCommands.push(["sadd", coin + ":activeMiners", minerAddress]);
      redisCommands.push([
        "setex",
        coin + ":worker:" + workerAddress,
        3600,
        dateNow,
      ]);

      // Track miner type
      redisCommands.push([
        "hset",
        coin + ":minerTypes",
        minerAddress,
        isSoloMining ? "solo" : "pool",
      ]);
    } else {
      // INVALID SHARES
      stats.shares.invalid++;

      redisCommands.push(["hincrby", coin + ":stats", "invalidShares", 1]);

      // Track invalid shares per worker
      if (isSoloMining) {
        redisCommands.push([
          "hincrby",
          coin + ":stats:solo",
          "invalidShares",
          1,
        ]);
        redisCommands.push([
          "hincrby",
          coin + ":workers:solo:" + workerAddress,
          "invalidShares",
          1,
        ]);

        // Negative difficulty for invalid shares in hashrate calculation
        var hashrateData = [-shareData.difficulty, shareData.worker, dateNow];
        redisCommands.push([
          "zadd",
          coin + ":hashrate:solo",
          (dateNow / 1000) | 0,
          hashrateData.join(":"),
        ]);

        logger.warning(
          logSystem,
          logComponent,
          logSubCat,
          "[SOLO Invalid] Worker " + workerAddress + " submitted invalid share",
        );
      } else {
        redisCommands.push([
          "hincrby",
          coin + ":workers:" + workerAddress,
          "invalidShares",
          1,
        ]);

        // Negative difficulty for invalid shares
        var hashrateData = [-shareData.difficulty, shareData.worker, dateNow];
        redisCommands.push([
          "zadd",
          coin + ":hashrate",
          (dateNow / 1000) | 0,
          hashrateData.join(":"),
        ]);

        logger.warning(
          logSystem,
          logComponent,
          logSubCat,
          "[POOL Invalid] Worker " + workerAddress + " submitted invalid share",
        );
      }

      // Log high invalid share rate warning
      if (stats.shares.invalid > 10) {
        var totalShares =
          stats.shares.pool + stats.shares.solo + stats.shares.invalid;
        var invalidRate = ((stats.shares.invalid / totalShares) * 100).toFixed(
          2,
        );
        if (invalidRate > 5) {
          logger.warning(
            logSystem,
            logComponent,
            logSubCat,
            "High invalid share rate detected: " +
              invalidRate +
              "% (" +
              stats.shares.invalid +
              "/" +
              totalShares +
              ")",
          );
        }
      }
    }

    // BLOCK HANDLING
    if (isValidBlock) {
      var blockInfo = {
        hash: shareData.blockHash,
        height: shareData.height,
        worker: shareData.worker,
        reward: shareData.blockReward,
        txHash: shareData.txHash || shareData.blockHash,
      };

      if (isSoloMining) {
        // SOLO BLOCK FOUND
        stats.blocks.solo++;

        logger.special(
          logSystem,
          logComponent,
          logSubCat,
          "★★★ SOLO BLOCK FOUND! ★★★ Height: " +
            blockInfo.height +
            ", Worker: " +
            blockInfo.worker +
            ", Hash: " +
            blockInfo.hash,
        );

        // Log to structured data for monitoring
        logger.logStructured({
          severity: "special",
          system: logSystem,
          component: logComponent,
          text: "SOLO BLOCK FOUND",
          data: {
            height: blockInfo.height,
            hash: blockInfo.hash,
            worker: blockInfo.worker,
            minerAddress: minerAddress,
            workerName: workerName,
            timestamp: dateNow,
            reward: blockInfo.reward,
          },
        });

        // Store solo block
        redisCommands.push([
          "sadd",
          coin + ":blocksPending:solo",
          [
            blockInfo.hash,
            blockInfo.txHash,
            blockInfo.height,
            blockInfo.worker,
            dateNow,
          ].join(":"),
        ]);

        // Store solo shares for this block height
        redisCommands.push([
          "hset",
          coin + ":shares:round" + blockInfo.height + ":solo",
          shareData.worker,
          "1",
        ]);

        // Also store times for compatibility
        redisCommands.push([
          "hset",
          coin + ":shares:times" + blockInfo.height,
          minerAddress,
          "1",
        ]);

        // Each solo miner has their own round: start a new one for the finder
        // only. (Deleting these keys reset every solo miner's round shares and
        // best share whenever anyone found a block.) The last-share time in
        // :shares:timesCurrent:solo is kept; the finder just submitted a share.
        redisCommands.push(["hdel", coin + ":shares:roundCurrent:solo", shareData.worker]);
        redisCommands.push(["hdel", coin + ":shares:diffCurrent:solo", shareData.worker]);
        redisCommands.push(["zrem", coin + ":shares:bestDiff:solo", shareData.worker]);

        // Update solo block stats
        redisCommands.push(["hincrby", coin + ":stats:solo", "validBlocks", 1]);
        redisCommands.push([
          "hincrby",
          coin + ":workers:solo:" + workerAddress,
          "blocks",
          1,
        ]);

        // Store last block info
        redisCommands.push([
          "hset",
          coin + ":lastBlock:solo",
          "height",
          blockInfo.height,
        ]);
        redisCommands.push([
          "hset",
          coin + ":lastBlock:solo",
          "worker",
          blockInfo.worker,
        ]);
        redisCommands.push(["hset", coin + ":lastBlock:solo", "time", dateNow]);
      } else {
        // POOL BLOCK FOUND
        stats.blocks.pool++;

        logger.special(
          logSystem,
          logComponent,
          logSubCat,
          "★★★ POOL BLOCK FOUND! ★★★ Height: " +
            blockInfo.height +
            ", Worker: " +
            blockInfo.worker +
            ", Hash: " +
            blockInfo.hash,
        );

        // Log to structured data
        logger.logStructured({
          severity: "special",
          system: logSystem,
          component: logComponent,
          text: "POOL BLOCK FOUND",
          data: {
            height: blockInfo.height,
            hash: blockInfo.hash,
            worker: blockInfo.worker,
            minerAddress: minerAddress,
            workerName: workerName,
            timestamp: dateNow,
            reward: blockInfo.reward,
          },
        });

        // Rename current round shares to height-specific keys
        redisCommands.push([
          "rename",
          coin + ":shares:roundCurrent",
          coin + ":shares:round" + blockInfo.height,
        ]);
        redisCommands.push([
          "rename",
          coin + ":shares:timesCurrent",
          coin + ":shares:times" + blockInfo.height,
        ]);
        redisCommands.push([
          "rename",
          coin + ":shares:diffCurrent",
          coin + ":shares:diffs" + blockInfo.height,
        ]);
        redisCommands.push([
          "rename",
          coin + ":shares:bestDiff",
          coin + ":shares:bestDiffs" + blockInfo.height,
        ]);

        // Store pool block
        redisCommands.push([
          "sadd",
          coin + ":blocksPending",
          [
            blockInfo.hash,
            blockInfo.txHash,
            blockInfo.height,
            blockInfo.worker,
            dateNow,
          ].join(":"),
        ]);

        // Update pool block stats
        redisCommands.push([
          "hincrby",
          coin + ":workers:" + workerAddress,
          "blocks",
          1,
        ]);

        // Store last block info
        redisCommands.push([
          "hset",
          coin + ":lastBlock:pool",
          "height",
          blockInfo.height,
        ]);
        redisCommands.push([
          "hset",
          coin + ":lastBlock:pool",
          "worker",
          blockInfo.worker,
        ]);
        redisCommands.push(["hset", coin + ":lastBlock:pool", "time", dateNow]);
      }

      // Update general block stats
      redisCommands.push(["hincrby", coin + ":stats", "validBlocks", 1]);
      // New pool effort round; the total is in this MULTI's incrbyfloat reply
      if (effortReplyIndex >= 0) {
        redisCommands.push(["del", coin + ":shares:effortCurrent"]);
      }
      stats.lastBlock = blockInfo;

      // Calculate time since last block
      if (stats.lastBlockTime) {
        var timeSince = (dateNow - stats.lastBlockTime) / 1000;
        logger.info(
          logSystem,
          logComponent,
          logSubCat,
          "Time since last block: " + formatDuration(timeSince * 1000),
        );
      }
      stats.lastBlockTime = dateNow;
    }

    // Execute all Redis commands
    perfStats.redisWrites += redisCommands.length;

    connection.multi(redisCommands).exec(function (err, replies) {
      var processTime = Date.now() - processStart;
      perfStats.totalProcessTime += processTime;
      perfStats.processCount++;
      perfStats.avgProcessTime =
        perfStats.totalProcessTime / perfStats.processCount;

      if (err) {
        perfStats.redisErrors++;
        logger.error(
          logSystem,
          logComponent,
          logSubCat,
          "Redis multi-exec error (#" +
            perfStats.redisErrors +
            "): " +
            JSON.stringify(err) +
            " | Commands: " +
            redisCommands.length +
            ", Process time: " +
            processTime +
            "ms",
        );
      } else {
        // Log slow operations
        if (processTime > 100) {
          logger.warning(
            logSystem,
            logComponent,
            logSubCat,
            "Slow share processing detected: " +
              processTime +
              "ms for " +
              redisCommands.length +
              " Redis commands",
          );
        }

        // Log successful block storage
        if (isValidBlock) {
          recordBlockEffort(shareData, isSoloMining, dateNow, {
            pool: replies && effortReplyIndex >= 0 ? replies[effortReplyIndex] : null,
            miner: replies && minerRoundReplyIndex >= 0 ? replies[minerRoundReplyIndex] : null,
          });
          logger.success(
            logSystem,
            logComponent,
            logSubCat,
            (isSoloMining ? "SOLO" : "POOL") +
              " block " +
              shareData.height +
              " stored successfully (" +
              redisCommands.length +
              " commands, " +
              processTime +
              "ms)",
          );
        }
      }
    });
  };

  // Block details for the website, keyed by block hash in <coin>:blockEffort
  // (JSON: shareDiff, netDiff, effort, minerEffort), plus the last 50 pool
  // efforts in <coin>:effortHistory for the pool's average and chart.
  // effort = pool effort (all miners since the pool's previous block);
  // minerEffort = the finder's own round: a solo worker's round, or the
  // shared round for pool blocks. Both are work / network diff (1 = 100%).
  function recordBlockEffort(shareData, isSolo, dateNow, totals) {
    var netDiff = parseFloat(shareData.blockDiff);
    if (!(netDiff > 0) || !shareData.blockHash) return;
    var ratio = function (work) {
      var w = parseFloat(work);
      return w > 0 ? Math.round((w / netDiff) * 10000) / 10000 : null;
    };
    var store = function (minerWork) {
      var effort = ratio(totals.pool);
      var details = {
        shareDiff: parseFloat(shareData.shareDiff) || null,
        netDiff: netDiff,
        effort: effort,
        minerEffort: ratio(minerWork),
      };
      var commands = [["hset", coin + ":blockEffort", shareData.blockHash, JSON.stringify(details)]];
      if (effort !== null) {
        commands.push(
          [
            "lpush",
            coin + ":effortHistory",
            JSON.stringify({
              height: shareData.height,
              time: (dateNow / 1000) | 0,
              effort: effort,
              type: isSolo ? "solo" : "pool",
            }),
          ],
          ["ltrim", coin + ":effortHistory", 0, 49],
        );
      }
      connection.multi(commands).exec(function (err) {
        if (err) {
          perfStats.redisErrors++;
          logger.error(
            logSystem,
            logComponent,
            logSubCat,
            "Error storing effort for block " + shareData.height + ": " + JSON.stringify(err),
          );
          return;
        }
        logger.info(
          logSystem,
          logComponent,
          logSubCat,
          "Block " + shareData.height + " effort: pool " +
            (effort === null ? "n/a" : (effort * 100).toFixed(1) + "%") +
            ", finder " +
            (details.minerEffort === null ? "n/a" : (details.minerEffort * 100).toFixed(1) + "%") +
            " (share " + formatCompactNumber(details.shareDiff) + " / net " + formatCompactNumber(netDiff) + ")",
        );
      });
    };
    if (isSolo) return store(totals.miner);
    // pool blocks: the shared round was just renamed to round<height>
    connection.hvals(coin + ":shares:round" + shareData.height, function (err, values) {
      var sum = 0;
      (err ? [] : values || []).forEach(function (v) {
        sum += parseFloat(v) || 0;
      });
      store(sum);
    });
  }

  // Helper function to format duration
  function formatDuration(ms) {
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);

    if (days > 0)
      return days + "d " + (hours % 24) + "h " + (minutes % 60) + "m";
    if (hours > 0)
      return hours + "h " + (minutes % 60) + "m " + (seconds % 60) + "s";
    if (minutes > 0) return minutes + "m " + (seconds % 60) + "s";
    return seconds + "s";
  }

  // Cleanup inactive workers periodically (every 6 hours)
  setInterval(
    function () {
      var now = Date.now();
      var inactiveThreshold = 48 * 60 * 60 * 1000; // 48 hours
      var beforeCount = stats.workers.size;

      // Remove workers inactive for more than 48 hours
      for (var [workerAddress, lastSeen] of stats.workers) {
        if (now - lastSeen > inactiveThreshold) {
          stats.workers.delete(workerAddress);
        }
      }

      var afterCount = stats.workers.size;
      if (beforeCount > afterCount) {
        logger.info(
          logSystem,
          logComponent,
          logSubCat,
          "Worker cleanup: removed " +
            (beforeCount - afterCount) +
            " inactive workers (48h+ idle), " +
            afterCount +
            " remain",
        );
      }
    },
    6 * 60 * 60 * 1000,
  ); // Every 6 hours

  // Reset performance stats periodically (every 24 hours)
  setInterval(
    function () {
      var timeSinceReset = Date.now() - perfStats.lastReset;

      logger.info(
        logSystem,
        logComponent,
        logSubCat,
        "Performance stats (24h) - Redis writes: " +
          perfStats.redisWrites +
          ", Errors: " +
          perfStats.redisErrors +
          ", Avg process time: " +
          perfStats.avgProcessTime.toFixed(2) +
          "ms",
      );

      // Reset counters but keep running totals in logs
      perfStats.redisWrites = 0;
      perfStats.redisErrors = 0;
      perfStats.avgProcessTime = 0;
      perfStats.totalProcessTime = 0;
      perfStats.processCount = 0;
      perfStats.lastReset = Date.now();

      logger.debug(
        logSystem,
        logComponent,
        logSubCat,
        "Performance stats reset",
      );
    },
    24 * 60 * 60 * 1000,
  ); // Every 24 hours
};
