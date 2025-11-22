var stats = require("./stats.js");

module.exports = function (logger, portalConfig, poolConfigs) {
  var _this = this;

  var portalStats = (this.stats = new stats(logger, portalConfig, poolConfigs));

  this.liveStatConnections = {};

  // API request tracking
  var apiStats = {
    requests: {},
    errors: 0,
    startTime: Date.now(),
    lastHour: [],
  };

  var logSystem = "API";

  // Helper function to track requests
  function trackRequest(method, duration, error) {
    apiStats.requests[method] = (apiStats.requests[method] || 0) + 1;
    if (error) apiStats.errors++;

    // Track last hour of requests
    var now = Date.now();
    apiStats.lastHour.push({ method: method, time: now, duration: duration });
    apiStats.lastHour = apiStats.lastHour.filter((r) => now - r.time < 3600000);
  }

  this.handleApiRequest = function (req, res, next) {
    var method = req.params.method;
    var requestStart = Date.now();

    // Log API request
    logger.debug(
      logSystem,
      "Request",
      "Method: " + method + ", IP: " + (req.ip || req.connection.remoteAddress)
    );

    switch (method) {
      case "stats":
        res.header("Content-Type", "application/json");
        res.end(JSON.stringify(portalStats.stats));

        // Log and track
        var duration = Date.now() - requestStart;
        logger.debug(
          logSystem,
          "Response",
          "Stats served in " + duration + "ms"
        );
        trackRequest("stats", duration);
        return;

      case "pool_stats":
        res.header("Content-Type", "application/json");
        res.end(JSON.stringify(portalStats.statPoolHistory));

        // Log and track
        var duration = Date.now() - requestStart;
        logger.debug(
          logSystem,
          "Response",
          "Pool stats served in " + duration + "ms"
        );
        trackRequest("pool_stats", duration);
        return;

      case "blocks":
      case "getblocksstats":
        var blockStart = Date.now();
        portalStats.getBlocks(function (data) {
          // Group blocks by pool
          var poolBlocks = {};

          if (data) {
            for (var blockId in data) {
              var block = data[blockId];
              var poolName = block.pool;

              if (!poolBlocks[poolName]) {
                poolBlocks[poolName] = [];
              }

              var parts = block.data.split(":");
              var timeInMs = parseInt(parts[4]);
              var timeInSec = Math.floor(timeInMs / 1000);
              poolBlocks[poolName].push({
                height: parseInt(parts[2]),
                hash: parts[0],
                time: timeInSec,
                status: block.status,
                miner: parts[3],
                type: block.type, // 'pool' or 'solo'
              });
            }

            // Sort each pool's blocks
            for (var pool in poolBlocks) {
              poolBlocks[pool].sort((a, b) => b.height - a.height);
            }
          }

          res.header("Content-Type", "application/json");
          res.end(JSON.stringify(poolBlocks));

          var duration = Date.now() - blockStart;
          var totalBlocks = data ? Object.keys(data).length : 0;
          logger.debug(
            logSystem,
            "Response",
            "Blocks data served - " + totalBlocks + " blocks"
          );
          trackRequest("blocks", duration);
        });
        break;

      case "payments":
        var poolBlocks = [];
        var blockCount = 0;

        for (var pool in portalStats.stats.pools) {
          var payments = portalStats.stats.pools[pool].payments;
          // Limit to last 25 payments (most recent)
          if (payments && payments.length > 25) {
            payments = payments.slice(-25);
          }
          blockCount += payments ? payments.length : 0;
          poolBlocks.push({
            name: pool,
            pending: portalStats.stats.pools[pool].pending,
            payments: payments,
          });
        }
        res.header("Content-Type", "application/json");
        res.end(JSON.stringify(poolBlocks));

        // Log and track
        var duration = Date.now() - requestStart;
        logger.debug(
          logSystem,
          "Response",
          "Payments served in " + duration + "ms (" + blockCount + " payments)"
        );
        trackRequest("payments", duration);
        return;

      case "worker_stats":
        res.header("Content-Type", "application/json");

        var address = req.query.addr || req.query.address || null;

        // Fallback parsing if req.query doesn't work
        if (!address && req.url.indexOf("?") > 0) {
          var queryString = req.url.split("?")[1];
          var params = {};
          queryString.split("&").forEach(function (param) {
            var parts = param.split("=");
            if (parts.length === 2) {
              params[parts[0]] = parts[1];
            }
          });
          address = params.addr || params.address || null;
        }

        // NOW check if we have an address (outside the fallback block)
        if (address && address.length > 0) {
          // Initialize these variables here
          var history = {};
          var workers = {};

          // Log worker stats request
          logger.info(
            logSystem,
            "WorkerStats",
            "Stats requested for address: " + address
          );

          // make sure it is just the miners address
          address = address.split(".")[0];
          var workerStatsStart = Date.now();

          // get miners balance along with worker balances
          portalStats.getBalanceByAddress(address, function (balances) {
            // get current round share total
            portalStats.getTotalSharesByAddress(address, function (shares) {
              var totalHash = parseFloat(0.0);
              var totalShares = shares;
              var networkHash = 0;
              var isSoloMiner = false;
              var workerCount = 0;
              var soloWorkerCount = 0;

              // Check history for both regular and solo workers
              for (var h in portalStats.statHistory) {
                for (var pool in portalStats.statHistory[h].pools) {
                  // Check regular workers
                  for (var w in portalStats.statHistory[h].pools[pool]
                    .workers) {
                    if (w.startsWith(address)) {
                      if (history[w] == null) {
                        history[w] = [];
                      }
                      if (
                        portalStats.statHistory[h].pools[pool].workers[w]
                          .hashrate
                      ) {
                        history[w].push({
                          time: portalStats.statHistory[h].time,
                          hashrate:
                            portalStats.statHistory[h].pools[pool].workers[w]
                              .hashrate,
                        });
                      }
                    }
                  }
                  // Check solo workers in history if they exist
                  if (portalStats.statHistory[h].pools[pool].soloWorkers) {
                    for (var w in portalStats.statHistory[h].pools[pool]
                      .soloWorkers) {
                      if (w.startsWith(address)) {
                        if (history[w] == null) {
                          history[w] = [];
                        }
                        if (
                          portalStats.statHistory[h].pools[pool].soloWorkers[w]
                            .hashrate
                        ) {
                          history[w].push({
                            time: portalStats.statHistory[h].time,
                            hashrate:
                              portalStats.statHistory[h].pools[pool]
                                .soloWorkers[w].hashrate,
                          });
                        }
                      }
                    }
                  }
                }
              }

              // Check current stats for both regular and solo workers
              for (var pool in portalStats.stats.pools) {
                // Check regular workers
                for (var w in portalStats.stats.pools[pool].workers) {
                  if (w.startsWith(address)) {
                    workerCount++;
                    workers[w] = portalStats.stats.pools[pool].workers[w];
                    for (var b in balances.balances) {
                      if (w == balances.balances[b].worker) {
                        workers[w].paid = balances.balances[b].paid;
                        workers[w].balance = balances.balances[b].balance;
                      }
                    }
                    workers[w].balance = workers[w].balance || 0;
                    workers[w].paid = workers[w].paid || 0;
                    totalHash +=
                      portalStats.stats.pools[pool].workers[w].hashrate;
                    networkHash =
                      portalStats.stats.pools[pool].poolStats.networkHash;
                  }
                }

                // Check solo workers
                if (portalStats.stats.pools[pool].soloWorkers) {
                  for (var w in portalStats.stats.pools[pool].soloWorkers) {
                    if (w.startsWith(address)) {
                      isSoloMiner = true;
                      soloWorkerCount++;
                      workers[w] = portalStats.stats.pools[pool].soloWorkers[w];
                      workers[w].isSolo = true; // Mark as solo worker

                      // Check for solo balances
                      for (var b in balances.balances) {
                        if (w == balances.balances[b].worker) {
                          workers[w].paid = balances.balances[b].paid;
                          workers[w].balance = balances.balances[b].balance;
                        }
                      }
                      workers[w].balance = workers[w].balance || 0;
                      workers[w].paid = workers[w].paid || 0;
                      totalHash +=
                        portalStats.stats.pools[pool].soloWorkers[w].hashrate ||
                        0;
                      networkHash =
                        portalStats.stats.pools[pool].poolStats.networkHash;
                    }
                  }
                }
              }

              res.end(
                JSON.stringify({
                  miner: address,
                  isSoloMiner: isSoloMiner,
                  totalHash: totalHash,
                  totalShares: totalShares,
                  networkHash: networkHash,
                  immature: balances.totalImmature,
                  balance: balances.totalHeld,
                  paid: balances.totalPaid,
                  workers: workers,
                  history: history,
                })
              );

              // Log completion
              var duration = Date.now() - workerStatsStart;
              logger.info(
                logSystem,
                "WorkerStats",
                "Stats for " +
                  address +
                  " served in " +
                  duration +
                  "ms - " +
                  "Workers: " +
                  workerCount +
                  " pool, " +
                  soloWorkerCount +
                  " solo, " +
                  "Hashrate: " +
                  (totalHash / 1000000).toFixed(2) +
                  " MH/s"
              );
              trackRequest("worker_stats", duration);
            });
          });
        } else {
          // Log error
          logger.warning(
            logSystem,
            "WorkerStats",
            "Invalid or missing address parameter"
          );
          res.end(
            JSON.stringify({ result: "error", message: "Invalid address" })
          );
          trackRequest("worker_stats", Date.now() - requestStart, true);
        }
        return;

      case "live_stats":
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "X-Accel-Buffering": "no",
        });

        // Send initial comment to establish connection
        //res.write('***sha256-mining.go.ro***\n*******mining pool*******\n       live stats\n\n');

        var uid = Math.random().toString();
        _this.liveStatConnections[uid] = res;

        // Log new live connection
        logger.info(
          logSystem,
          "LiveStats",
          "New live stats connection: " +
            uid +
            " from " +
            (req.ip || req.connection.remoteAddress) +
            " (Total connections: " +
            Object.keys(_this.liveStatConnections).length +
            ")"
        );

        // Send initial stats if available
        if (portalStats.stats) {
          res.write("data: " + JSON.stringify(portalStats.stats) + "\n\n");
        }

        // Only call flush if it exists
        if (typeof res.flush === "function") {
          res.flush();
        }

        req.on("close", function () {
          delete _this.liveStatConnections[uid];

          // Log disconnection
          logger.debug(
            logSystem,
            "LiveStats",
            "Connection closed: " +
              uid +
              " (Remaining: " +
              Object.keys(_this.liveStatConnections).length +
              ")"
          );
        });

        trackRequest("live_stats", 0);
        return;

      case "pool_message":
        // Public endpoint to get current pool message
        var fs = require("fs");
        var path = require("path");
        var messageFile = path.join(__dirname, "..", "pool_message.json");

        fs.readFile(messageFile, "utf8", function (err, data) {
          res.header("Content-Type", "application/json");

          if (err) {
            if (err.code === "ENOENT") {
              // No message file, return null
              res.end(JSON.stringify({ result: null }));
            } else {
              logger.error(
                logSystem,
                "Response",
                "Failed to read pool message: " + err
              );
              res.end(JSON.stringify({ result: null }));
            }
            trackRequest("pool_message", Date.now() - requestStart);
            return;
          }

          try {
            var message = JSON.parse(data);
            // Only return message if it's enabled
            if (message && message.enabled) {
              res.end(JSON.stringify({ result: message }));
            } else {
              res.end(JSON.stringify({ result: null }));
            }
            trackRequest("pool_message", Date.now() - requestStart);
          } catch (parseErr) {
            logger.error(
              logSystem,
              "Response",
              "Failed to parse pool message: " + parseErr
            );
            res.end(JSON.stringify({ result: null }));
            trackRequest("pool_message", Date.now() - requestStart, true);
          }
        });
        return;

      default:
        // Log unknown method
        logger.warning(logSystem, "Request", "Unknown API method: " + method);
        trackRequest("unknown", Date.now() - requestStart, true);
        next();
    }
  };

  this.handleAdminApiRequest = function (req, res, next) {
    var method = req.params.method;
    var requestStart = Date.now();

    // Log admin request
    logger.warning(
      logSystem,
      "Admin",
      "Admin API request: " +
        method +
        " from " +
        (req.ip || req.connection.remoteAddress)
    );

    switch (method) {
      case "pools":
        // Enhance pool data with live stats
        var enhancedPools = {};

        for (var poolName in poolConfigs) {
          var poolConfig = poolConfigs[poolName];
          var poolStats =
            portalStats.stats.pools && portalStats.stats.pools[poolName]
              ? portalStats.stats.pools[poolName]
              : null;

          enhancedPools[poolName] = {
            config: poolConfig,
            stats: poolStats
              ? {
                  hashrate: poolStats.hashrate || 0,
                  networkHashrate: poolStats.poolStats
                    ? poolStats.poolStats.networkHash
                    : 0,
                  networkHashString: poolStats.poolStats
                    ? poolStats.poolStats.networkHashString
                    : "0 H/s",
                  networkDiff: poolStats.poolStats
                    ? poolStats.poolStats.networkDiff
                    : 0,
                  networkBlocks: poolStats.poolStats
                    ? poolStats.poolStats.networkBlocks
                    : 0,
                  minerCount: poolStats.minerCount || 0,
                  workerCount: poolStats.workerCount || 0,
                  poolMinerCount: poolStats.poolMinerCount || 0,
                  poolWorkerCount: poolStats.poolWorkerCount || 0,
                  soloMinerCount: poolStats.soloMinerCount || 0,
                  soloWorkerCount: poolStats.soloWorkerCount || 0,
                  blocks: poolStats.blocks || {},
                  pending: poolStats.pending || {},
                }
              : null,
          };
        }

        res.end(JSON.stringify({ result: enhancedPools }));

        // Log completion
        var duration = Date.now() - requestStart;
        logger.info(
          logSystem,
          "Admin",
          "Enhanced pool data served in " + duration + "ms"
        );
        trackRequest("admin_pools", duration);
        return;

      case "overview":
        // Aggregate system-wide statistics
        var overviewData = {
          systemStatus: {
            totalPools: 0,
            activePools: 0,
            totalMiners: 0,
            totalHashrate: 0,
            uptime: Math.floor((Date.now() - apiStats.startTime) / 1000),
          },
          poolSummary: [],
          recentActivity: {
            blocks: [],
            payments: [],
            connections: [],
          },
          systemHealth: {
            api: {
              status: "operational",
              requests: Object.values(apiStats.requests).reduce(
                (a, b) => a + b,
                0
              ),
              errors: apiStats.errors,
              errorRate: 0,
              avgResponseTime: 0,
            },
            pools: [],
          },
        };

        // Use global stats for active miners and total hashrate
        if (portalStats.stats.global) {
          overviewData.systemStatus.totalMiners =
            portalStats.stats.global.miners || 0;
          overviewData.systemStatus.totalHashrate =
            portalStats.stats.global.hashrate || 0;
        }

        // Calculate total pools and build pool summary
        for (var poolName in poolConfigs) {
          overviewData.systemStatus.totalPools++;

          var poolStats =
            portalStats.stats.pools && portalStats.stats.pools[poolName]
              ? portalStats.stats.pools[poolName]
              : null;

          if (poolStats) {
            // Count as active if pool has stats
            if (poolStats.poolStats) {
              overviewData.systemStatus.activePools++;
            }

            // Get pool data from stats
            var poolMinerCount = poolStats.minerCount || 0;
            var poolWorkerCount = poolStats.workerCount || 0;
            var poolHashrate = poolStats.hashrate || 0;

            // Calculate total blocks (pending + confirmed + orphaned)
            var totalBlocks = 0;
            if (poolStats.blocks) {
              totalBlocks =
                (poolStats.blocks.pending || 0) +
                (poolStats.blocks.confirmed || 0) +
                (poolStats.blocks.orphaned || 0);
            }

            // Add to pool summary
            overviewData.poolSummary.push({
              name: poolName,
              coin: poolConfigs[poolName].coin,
              symbol: poolStats.symbol || poolConfigs[poolName].coin,
              status: poolStats.poolStats ? "active" : "idle",
              miners: poolMinerCount,
              workers: poolWorkerCount,
              hashrate: poolHashrate,
              hashrateString: poolStats.hashrateString || "0 H/s",
              blocks: totalBlocks,
            });

            // Pool health check
            var poolHealth = {
              pool: poolName,
              status: "operational",
              issues: [],
            };

            // Check for issues
            if (poolMinerCount === 0 && poolWorkerCount === 0) {
              poolHealth.status = "warning";
              poolHealth.issues.push("No active miners");
            }
            if (poolHashrate === 0) {
              poolHealth.status = "warning";
              poolHealth.issues.push("Zero hashrate");
            }

            overviewData.systemHealth.pools.push(poolHealth);
          } else {
            // Pool has no stats - likely inactive
            overviewData.poolSummary.push({
              name: poolName,
              coin: poolConfigs[poolName].coin,
              symbol: poolConfigs[poolName].coin,
              status: "inactive",
              miners: 0,
              workers: 0,
              hashrate: 0,
              hashrateString: "0 H/s",
              blocks: 0,
            });

            overviewData.systemHealth.pools.push({
              pool: poolName,
              status: "error",
              issues: ["No stats available - pool may not be running"],
            });
          }
        }

        // Calculate API error rate
        var totalRequests = Object.values(apiStats.requests).reduce(
          (a, b) => a + b,
          0
        );
        if (totalRequests > 0) {
          overviewData.systemHealth.api.errorRate = (
            (apiStats.errors / totalRequests) *
            100
          ).toFixed(2);
        }

        // Calculate average response time
        if (apiStats.lastHour.length > 0) {
          overviewData.systemHealth.api.avgResponseTime = Math.round(
            apiStats.lastHour.reduce((sum, r) => sum + r.duration, 0) /
              apiStats.lastHour.length
          );
        }

        // Get recent blocks (last 10)
        portalStats.getBlocks(function (blocksData) {
          var recentBlocks = [];

          if (blocksData) {
            for (var blockId in blocksData) {
              var block = blocksData[blockId];
              var parts = block.data.split(":");
              var timeInMs = parseInt(parts[4]);

              recentBlocks.push({
                pool: block.pool,
                height: parseInt(parts[2]),
                hash: parts[0],
                time: Math.floor(timeInMs / 1000),
                miner: parts[3],
                type: block.type,
                status: block.status,
              });
            }

            // Sort by time and get last 10
            recentBlocks.sort((a, b) => b.time - a.time);
            overviewData.recentActivity.blocks = recentBlocks.slice(0, 10);
          }

          // Get recent payments (last 10)
          var recentPayments = [];
          for (var pool in portalStats.stats.pools) {
            var poolData = portalStats.stats.pools[pool];
            var payments = poolData.payments;
            if (payments && payments.length > 0) {
              payments.forEach(function (payment) {
                recentPayments.push({
                  pool: pool,
                  coin: poolConfigs[pool] ? poolConfigs[pool].coin : pool,
                  symbol:
                    poolData.symbol ||
                    (poolConfigs[pool] ? poolConfigs[pool].coin : pool),
                  time: payment.time,
                  paid: payment.paid,
                  miners: payment.miners,
                  txid: payment.txid,
                  isSolo: payment.isSolo || false,
                });
              });
            }
          }

          // Sort by time and get last 10
          recentPayments.sort((a, b) => b.time - a.time);
          overviewData.recentActivity.payments = recentPayments.slice(0, 10);

          // Recent connections (from live stats connections)
          overviewData.recentActivity.connections = Object.keys(
            _this.liveStatConnections
          ).length;

          res.end(JSON.stringify({ result: overviewData }));

          // Log completion
          var duration = Date.now() - requestStart;
          logger.info(
            logSystem,
            "Admin",
            "Overview data served in " + duration + "ms"
          );
          trackRequest("admin_overview", duration);
        });
        return;

      case "settings":
        var fs = require("fs");
        var path = require("path");

        // Get action from request body
        var action = req.body.action || "get_configs";

        if (action === "get_configs") {
          // Read config.json directly to get latest values
          var configPath = path.join(__dirname, "..", "config.json");

          fs.readFile(configPath, "utf8", function (err, data) {
            var currentConfig;

            if (err) {
              logger.warning(
                logSystem,
                "Admin",
                "Failed to read config.json, using cached values: " + err
              );
              currentConfig = portalConfig;
            } else {
              try {
                currentConfig = JSON.parse(data);
              } catch (parseErr) {
                logger.warning(
                  logSystem,
                  "Admin",
                  "Failed to parse config.json, using cached values: " +
                    parseErr
                );
                currentConfig = portalConfig;
              }
            }

            // Return pool configurations with system info
            var settingsData = {
              poolConfigs: poolConfigs,
              websiteConfig: {
                updateInterval:
                  currentConfig.website && currentConfig.website.stats
                    ? currentConfig.website.stats.updateInterval
                    : 90,
                historicalRetention:
                  currentConfig.website && currentConfig.website.stats
                    ? currentConfig.website.stats.historicalRetention
                    : 28800,
                hashrateWindow:
                  currentConfig.website && currentConfig.website.stats
                    ? currentConfig.website.stats.hashrateWindow
                    : 600,
              },
              systemInfo: {
                uptime: Math.floor((Date.now() - apiStats.startTime) / 1000),
                activeMiners: 0,
                activePools: 0,
                startTime: apiStats.startTime,
              },
            };

            // Count active miners from global stats
            if (portalStats.stats.global) {
              settingsData.systemInfo.activeMiners =
                portalStats.stats.global.miners || 0;
            }

            // Count active pools
            for (var poolName in poolConfigs) {
              if (poolConfigs[poolName].enabled) {
                settingsData.systemInfo.activePools++;
              }
            }

            res.end(JSON.stringify({ result: settingsData }));
            logger.info(
              logSystem,
              "Admin",
              "Settings configs served in " + (Date.now() - requestStart) + "ms"
            );
            trackRequest("admin_settings_get", Date.now() - requestStart);
          });
          return;
        } else if (action === "update_config") {
          var poolName = req.body.poolName;
          var newConfig = req.body.config;

          if (!poolName || !newConfig) {
            res.end(JSON.stringify({ error: "Missing poolName or config" }));
            trackRequest(
              "admin_settings_update",
              Date.now() - requestStart,
              true
            );
            return;
          }

          // Validate pool exists
          if (!poolConfigs[poolName]) {
            res.end(JSON.stringify({ error: "Pool not found" }));
            trackRequest(
              "admin_settings_update",
              Date.now() - requestStart,
              true
            );
            return;
          }

          // Merge with existing config
          var updatedConfig = Object.assign(
            {},
            poolConfigs[poolName],
            newConfig
          );

          // Validate critical fields
          if (updatedConfig.paymentProcessing) {
            var pp = updatedConfig.paymentProcessing;
            if (pp.poolFee < 0 || pp.poolFee > 100) {
              res.end(
                JSON.stringify({ error: "Pool fee must be between 0 and 100" })
              );
              trackRequest(
                "admin_settings_update",
                Date.now() - requestStart,
                true
              );
              return;
            }
            if (pp.soloFee < 0 || pp.soloFee > 100) {
              res.end(
                JSON.stringify({ error: "Solo fee must be between 0 and 100" })
              );
              trackRequest(
                "admin_settings_update",
                Date.now() - requestStart,
                true
              );
              return;
            }
            if (pp.minimumPayment <= 0) {
              res.end(
                JSON.stringify({
                  error: "Minimum payment must be greater than 0",
                })
              );
              trackRequest(
                "admin_settings_update",
                Date.now() - requestStart,
                true
              );
              return;
            }
          }

          // Create backup
          var configPath = path.join(
            __dirname,
            "..",
            "pool_configs",
            poolName + ".json"
          );
          var backupDir = path.join(__dirname, "..", "pool_configs", "backups");

          // Ensure backup directory exists
          if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
          }

          var timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .split("T")
            .join("_")
            .split(".")[0];
          var backupPath = path.join(
            backupDir,
            poolName + ".json." + timestamp
          );

          // Read current config and create backup
          fs.readFile(configPath, "utf8", function (err, data) {
            if (!err) {
              fs.writeFile(backupPath, data, function (backupErr) {
                if (backupErr) {
                  logger.error(
                    logSystem,
                    "Admin",
                    "Failed to create backup: " + backupErr
                  );
                }
              });
            }

            // Write updated config
            fs.writeFile(
              configPath,
              JSON.stringify(updatedConfig, null, 2),
              function (writeErr) {
                if (writeErr) {
                  logger.error(
                    logSystem,
                    "Admin",
                    "Failed to write config: " + writeErr
                  );
                  res.end(
                    JSON.stringify({ error: "Failed to save configuration" })
                  );
                  trackRequest(
                    "admin_settings_update",
                    Date.now() - requestStart,
                    true
                  );
                  return;
                }

                // Update in-memory config
                poolConfigs[poolName] = updatedConfig;

                logger.warning(
                  logSystem,
                  "Admin",
                  "Configuration updated for pool: " +
                    poolName +
                    " by " +
                    (req.ip || req.connection.remoteAddress)
                );

                res.end(
                  JSON.stringify({
                    result: "success",
                    message:
                      "Configuration updated successfully. Restart required to apply changes.",
                    restartRequired: true,
                  })
                );

                trackRequest(
                  "admin_settings_update",
                  Date.now() - requestStart
                );
              }
            );
          });
          return;
        } else if (action === "restart") {
          var confirmation = req.body.confirmation;

          if (confirmation !== "RESTART") {
            res.end(JSON.stringify({ error: "Invalid confirmation code" }));
            trackRequest(
              "admin_settings_restart",
              Date.now() - requestStart,
              true
            );
            return;
          }

          // Log restart request
          logger.warning(
            logSystem,
            "Admin",
            "!!! POOL RESTART INITIATED by " +
              (req.ip || req.connection.remoteAddress)
          );
          logger.warning(
            logSystem,
            "Admin",
            "Active miners at restart: " +
              (portalStats.stats.global ? portalStats.stats.global.miners : 0)
          );
          logger.warning(
            logSystem,
            "Admin",
            "Active pools: " +
              Object.keys(poolConfigs).filter((p) => poolConfigs[p].enabled)
                .length
          );

          // Send response before restart
          res.end(
            JSON.stringify({
              result: "success",
              message:
                "Pool restart initiated. System will be back online shortly.",
            })
          );

          // Delay restart to allow response to be sent
          setTimeout(function () {
            logger.warning(logSystem, "Admin", "Executing pool restart now...");

            // Check if running under PM2
            if (process.env.PM2_HOME || process.env.pm_id) {
              logger.info(
                logSystem,
                "Admin",
                "PM2 detected - using process.exit(0) for graceful restart"
              );
              process.exit(0);
            }
            // Check if running under systemd
            else if (process.env.INVOCATION_ID) {
              logger.info(
                logSystem,
                "Admin",
                "systemd detected - using process.exit(0) for graceful restart"
              );
              process.exit(0);
            }
            // No process manager detected
            else {
              logger.warning(
                logSystem,
                "Admin",
                "No process manager detected! Manual restart may be required."
              );
              logger.warning(
                logSystem,
                "Admin",
                "Attempting restart with process.exit(0)..."
              );
              process.exit(0);
            }
          }, 1000);

          trackRequest("admin_settings_restart", Date.now() - requestStart);
          return;
        } else if (action === "update_website_config") {
          var updateInterval = parseInt(req.body.updateInterval);
          var historicalRetention = parseInt(req.body.historicalRetention);
          var hashrateWindow = parseInt(req.body.hashrateWindow);

          // Validate inputs
          if (
            isNaN(updateInterval) ||
            updateInterval < 10 ||
            updateInterval > 300
          ) {
            res.end(
              JSON.stringify({
                error: "Update interval must be between 10 and 300 seconds",
              })
            );
            trackRequest(
              "admin_settings_website",
              Date.now() - requestStart,
              true
            );
            return;
          }
          if (
            isNaN(historicalRetention) ||
            historicalRetention < 3600 ||
            historicalRetention > 86400
          ) {
            res.end(
              JSON.stringify({
                error:
                  "Historical retention must be between 3600 and 86400 seconds",
              })
            );
            trackRequest(
              "admin_settings_website",
              Date.now() - requestStart,
              true
            );
            return;
          }
          if (
            isNaN(hashrateWindow) ||
            hashrateWindow < 60 ||
            hashrateWindow > 1800
          ) {
            res.end(
              JSON.stringify({
                error: "Hashrate window must be between 60 and 1800 seconds",
              })
            );
            trackRequest(
              "admin_settings_website",
              Date.now() - requestStart,
              true
            );
            return;
          }

          // Read config.json
          var configPath = path.join(__dirname, "..", "config.json");

          fs.readFile(configPath, "utf8", function (err, data) {
            if (err) {
              logger.error(
                logSystem,
                "Admin",
                "Failed to read config.json: " + err
              );
              res.end(
                JSON.stringify({ error: "Failed to read configuration file" })
              );
              trackRequest(
                "admin_settings_website",
                Date.now() - requestStart,
                true
              );
              return;
            }

            var config;
            try {
              config = JSON.parse(data);
            } catch (parseErr) {
              logger.error(
                logSystem,
                "Admin",
                "Failed to parse config.json: " + parseErr
              );
              res.end(
                JSON.stringify({ error: "Failed to parse configuration file" })
              );
              trackRequest(
                "admin_settings_website",
                Date.now() - requestStart,
                true
              );
              return;
            }

            // Update website.stats settings
            if (!config.website) config.website = {};
            if (!config.website.stats) config.website.stats = {};

            config.website.stats.updateInterval = updateInterval;
            config.website.stats.historicalRetention = historicalRetention;
            config.website.stats.hashrateWindow = hashrateWindow;

            // Create backup before saving
            var backupDir = path.join(__dirname, "..", "backups");
            if (!fs.existsSync(backupDir)) {
              fs.mkdirSync(backupDir, { recursive: true });
            }

            var timestamp = new Date()
              .toISOString()
              .replace(/[:.]/g, "-")
              .split("T")
              .join("_")
              .split(".")[0];
            var backupPath = path.join(backupDir, "config.json." + timestamp);

            fs.writeFile(backupPath, data, function (backupErr) {
              if (backupErr) {
                logger.warning(
                  logSystem,
                  "Admin",
                  "Failed to create config backup: " + backupErr
                );
              }

              // Write updated config
              fs.writeFile(
                configPath,
                JSON.stringify(config, null, 4),
                function (writeErr) {
                  if (writeErr) {
                    logger.error(
                      logSystem,
                      "Admin",
                      "Failed to write config.json: " + writeErr
                    );
                    res.end(
                      JSON.stringify({ error: "Failed to save configuration" })
                    );
                    trackRequest(
                      "admin_settings_website",
                      Date.now() - requestStart,
                      true
                    );
                    return;
                  }

                  logger.warning(
                    logSystem,
                    "Admin",
                    "Website configuration updated by " +
                      (req.ip || req.connection.remoteAddress) +
                      " - updateInterval: " +
                      updateInterval +
                      ", historicalRetention: " +
                      historicalRetention +
                      ", hashrateWindow: " +
                      hashrateWindow
                  );

                  res.end(
                    JSON.stringify({
                      result: "success",
                      message:
                        "Website configuration updated successfully. Restart required to apply changes.",
                      restartRequired: true,
                    })
                  );

                  trackRequest(
                    "admin_settings_website",
                    Date.now() - requestStart
                  );
                }
              );
            });
          });
          return;
        } else {
          res.end(JSON.stringify({ error: "Invalid action" }));
          trackRequest("admin_settings", Date.now() - requestStart, true);
          return;
        }

      case "logs":
        var fs = require("fs");
        var path = require("path");
        var logsDir = path.join(__dirname, "..", "logs");

        // Get action from query string
        var action = req.query.action || "list";

        if (action === "list") {
          // List all log files
          fs.readdir(logsDir, function (err, files) {
            if (err) {
              logger.error(
                logSystem,
                "Admin",
                "Failed to read logs directory: " + err
              );
              res.end(
                JSON.stringify({ error: "Failed to read logs directory" })
              );
              trackRequest("admin_logs", Date.now() - requestStart, true);
              return;
            }

            // Filter only .log files and get their stats
            var logFiles = [];
            var pending = 0;

            files.forEach(function (file) {
              if (file.endsWith(".log")) {
                pending++;
                fs.stat(path.join(logsDir, file), function (err, stats) {
                  if (!err) {
                    logFiles.push({
                      name: file,
                      size: stats.size,
                      modified: stats.mtime.getTime(),
                    });
                  }
                  pending--;

                  if (pending === 0) {
                    // Sort by name
                    logFiles.sort((a, b) => a.name.localeCompare(b.name));

                    res.end(JSON.stringify({ result: logFiles }));

                    var duration = Date.now() - requestStart;
                    logger.info(
                      logSystem,
                      "Admin",
                      "Log files list served in " + duration + "ms"
                    );
                    trackRequest("admin_logs_list", duration);
                  }
                });
              }
            });

            if (pending === 0) {
              res.end(JSON.stringify({ result: [] }));
              trackRequest("admin_logs_list", Date.now() - requestStart);
            }
          });
        } else if (action === "read") {
          var filename = req.query.file;
          var lines = parseInt(req.query.lines) || 500;

          if (!filename || filename.indexOf("..") !== -1) {
            res.end(JSON.stringify({ error: "Invalid filename" }));
            trackRequest("admin_logs_read", Date.now() - requestStart, true);
            return;
          }

          var filePath = path.join(logsDir, filename);

          // Check if file exists and is in logs directory
          fs.realpath(filePath, function (err, resolvedPath) {
            if (err || !resolvedPath.startsWith(logsDir)) {
              res.end(
                JSON.stringify({ error: "File not found or access denied" })
              );
              trackRequest("admin_logs_read", Date.now() - requestStart, true);
              return;
            }

            // Read last N lines
            fs.readFile(resolvedPath, "utf8", function (err, data) {
              if (err) {
                logger.error(
                  logSystem,
                  "Admin",
                  "Failed to read log file: " + err
                );
                res.end(JSON.stringify({ error: "Failed to read log file" }));
                trackRequest(
                  "admin_logs_read",
                  Date.now() - requestStart,
                  true
                );
                return;
              }

              var allLines = data.split("\n");
              var lastLines = allLines.slice(-lines);

              res.end(
                JSON.stringify({
                  result: {
                    filename: filename,
                    lines: lastLines,
                    totalLines: allLines.length,
                  },
                })
              );

              var duration = Date.now() - requestStart;
              logger.info(
                logSystem,
                "Admin",
                "Log file " +
                  filename +
                  " served (" +
                  lastLines.length +
                  " lines) in " +
                  duration +
                  "ms"
              );
              trackRequest("admin_logs_read", duration);
            });
          });
        } else {
          res.end(JSON.stringify({ error: "Invalid action" }));
          trackRequest("admin_logs", Date.now() - requestStart, true);
        }
        return;

      case "pool_message":
        var fs = require("fs");
        var path = require("path");
        var messageFile = path.join(__dirname, "..", "pool_message.json");

        // Get action from request body
        var action = req.body.action || "get";

        if (action === "get") {
          // Read message file
          fs.readFile(messageFile, "utf8", function (err, data) {
            if (err) {
              if (err.code === "ENOENT") {
                // File doesn't exist, return null
                res.end(JSON.stringify({ result: null }));
                logger.debug(
                  logSystem,
                  "Admin",
                  "Pool message file not found - no message set"
                );
              } else {
                logger.error(
                  logSystem,
                  "Admin",
                  "Failed to read pool message: " + err
                );
                res.end(
                  JSON.stringify({ error: "Failed to read pool message" })
                );
                trackRequest(
                  "admin_pool_message_get",
                  Date.now() - requestStart,
                  true
                );
              }
              return;
            }

            try {
              var message = JSON.parse(data);
              res.end(JSON.stringify({ result: message }));
              logger.debug(logSystem, "Admin", "Pool message retrieved");
              trackRequest("admin_pool_message_get", Date.now() - requestStart);
            } catch (parseErr) {
              logger.error(
                logSystem,
                "Admin",
                "Failed to parse pool message: " + parseErr
              );
              res.end(
                JSON.stringify({ error: "Failed to parse pool message" })
              );
              trackRequest(
                "admin_pool_message_get",
                Date.now() - requestStart,
                true
              );
            }
          });
          return;
        } else if (action === "set") {
          var text = req.body.text;
          var color = req.body.color || "blue";
          var enabled =
            req.body.enabled !== undefined ? req.body.enabled : true;

          // Validation
          if (!text || text.trim().length === 0) {
            res.end(JSON.stringify({ error: "Message text is required" }));
            trackRequest(
              "admin_pool_message_set",
              Date.now() - requestStart,
              true
            );
            return;
          }

          if (text.length > 500) {
            res.end(
              JSON.stringify({
                error: "Message text must be 500 characters or less",
              })
            );
            trackRequest(
              "admin_pool_message_set",
              Date.now() - requestStart,
              true
            );
            return;
          }

          var validColors = ["blue", "green", "yellow", "red"];
          if (validColors.indexOf(color) === -1) {
            res.end(
              JSON.stringify({
                error: "Invalid color. Must be blue, green, yellow, or red",
              })
            );
            trackRequest(
              "admin_pool_message_set",
              Date.now() - requestStart,
              true
            );
            return;
          }

          // Create message object
          var now = new Date().toISOString();
          var message = {
            id: "pool-message-" + Date.now(),
            text: text.trim(),
            color: color,
            enabled: enabled,
            createdAt: now,
            updatedAt: now,
          };

          // Check if message already exists (to preserve createdAt)
          fs.readFile(messageFile, "utf8", function (err, data) {
            if (!err) {
              try {
                var existingMessage = JSON.parse(data);
                if (existingMessage.createdAt) {
                  message.createdAt = existingMessage.createdAt;
                }
                if (existingMessage.id) {
                  message.id = existingMessage.id;
                }
              } catch (parseErr) {
                // Ignore parse errors, use new message
              }
            }

            // Write message file
            fs.writeFile(
              messageFile,
              JSON.stringify(message, null, 2),
              function (writeErr) {
                if (writeErr) {
                  logger.error(
                    logSystem,
                    "Admin",
                    "Failed to save pool message: " + writeErr
                  );
                  res.end(
                    JSON.stringify({ error: "Failed to save pool message" })
                  );
                  trackRequest(
                    "admin_pool_message_set",
                    Date.now() - requestStart,
                    true
                  );
                  return;
                }

                logger.warning(
                  logSystem,
                  "Admin",
                  "Pool message updated by " +
                    (req.ip || req.connection.remoteAddress) +
                    ' - Text: "' +
                    text.substring(0, 50) +
                    (text.length > 50 ? "..." : "") +
                    '"' +
                    ", Color: " +
                    color +
                    ", Enabled: " +
                    enabled
                );

                res.end(
                  JSON.stringify({
                    result: "success",
                    message: "Pool message saved successfully",
                  })
                );

                trackRequest(
                  "admin_pool_message_set",
                  Date.now() - requestStart
                );
              }
            );
          });
          return;
        } else if (action === "delete") {
          // Delete message file
          fs.unlink(messageFile, function (err) {
            if (err && err.code !== "ENOENT") {
              logger.error(
                logSystem,
                "Admin",
                "Failed to delete pool message: " + err
              );
              res.end(
                JSON.stringify({ error: "Failed to delete pool message" })
              );
              trackRequest(
                "admin_pool_message_delete",
                Date.now() - requestStart,
                true
              );
              return;
            }

            logger.warning(
              logSystem,
              "Admin",
              "Pool message deleted by " +
                (req.ip || req.connection.remoteAddress)
            );

            res.end(
              JSON.stringify({
                result: "success",
                message: "Pool message cleared successfully",
              })
            );

            trackRequest(
              "admin_pool_message_delete",
              Date.now() - requestStart
            );
          });
          return;
        } else {
          res.end(JSON.stringify({ error: "Invalid action" }));
          trackRequest("admin_pool_message", Date.now() - requestStart, true);
          return;
        }

      default:
        logger.warning(logSystem, "Admin", "Unknown admin method: " + method);
        trackRequest("admin_unknown", Date.now() - requestStart, true);
        next();
    }
  };

  // API stats summary (log every 5 minutes if there's activity)
  setInterval(function () {
    if (Object.keys(apiStats.requests).length > 0) {
      var totalRequests = Object.values(apiStats.requests).reduce(
        (a, b) => a + b,
        0
      );
      var topMethods = Object.entries(apiStats.requests)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([method, count]) => method + "(" + count + ")")
        .join(", ");

      var avgResponseTime =
        apiStats.lastHour.length > 0
          ? apiStats.lastHour.reduce((sum, r) => sum + r.duration, 0) /
            apiStats.lastHour.length
          : 0;

      logger.info(
        logSystem,
        "Stats",
        "API requests - Total: " +
          totalRequests +
          ", Errors: " +
          apiStats.errors +
          ", Top methods: " +
          topMethods +
          ", Avg response: " +
          avgResponseTime.toFixed(0) +
          "ms" +
          ", Live connections: " +
          Object.keys(_this.liveStatConnections).length
      );
    }
  }, 300000); // Every 5 minutes
};
