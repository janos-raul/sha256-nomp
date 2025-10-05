var stats = require('./stats.js');

module.exports = function(logger, portalConfig, poolConfigs){

    var _this = this;

    var portalStats = this.stats = new stats(logger, portalConfig, poolConfigs);

    this.liveStatConnections = {};
    
    // API request tracking
    var apiStats = {
        requests: {},
        errors: 0,
        startTime: Date.now(),
        lastHour: []
    };
    
    var logSystem = 'API';
    
    // Helper function to track requests
    function trackRequest(method, duration, error) {
        apiStats.requests[method] = (apiStats.requests[method] || 0) + 1;
        if (error) apiStats.errors++;
        
        // Track last hour of requests
        var now = Date.now();
        apiStats.lastHour.push({ method: method, time: now, duration: duration });
        apiStats.lastHour = apiStats.lastHour.filter(r => now - r.time < 3600000);
    }

    this.handleApiRequest = function(req, res, next){
        var method = req.params.method;
        var requestStart = Date.now();
        
        // Log API request
        logger.debug(logSystem, 'Request', 'Method: ' + method + ', IP: ' + (req.ip || req.connection.remoteAddress));

        switch(method){
            case 'stats':
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(portalStats.stats));
                
                // Log and track
                var duration = Date.now() - requestStart;
                logger.debug(logSystem, 'Response', 'Stats served in ' + duration + 'ms');
                trackRequest('stats', duration);
                return;
                
            case 'pool_stats':
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(portalStats.statPoolHistory));
                
                // Log and track
                var duration = Date.now() - requestStart;
                logger.debug(logSystem, 'Response', 'Pool stats served in ' + duration + 'ms');
                trackRequest('pool_stats', duration);
                return;
                
			case 'blocks':
			case 'getblocksstats':
				var blockStart = Date.now();
				portalStats.getBlocks(function(data){
					// Group blocks by pool
					var poolBlocks = {};
					
					if (data) {
						for (var blockId in data) {
							var block = data[blockId];
							var poolName = block.pool;
							
							if (!poolBlocks[poolName]) {
								poolBlocks[poolName] = [];
							}
							
							var parts = block.data.split(':');
							var timeInMs = parseInt(parts[4]);
							var timeInSec = Math.floor(timeInMs / 1000);
							poolBlocks[poolName].push({
								height: parseInt(parts[2]),
								hash: parts[0],
								time: timeInSec,
								status: block.status,
								miner: parts[3],
								type: block.type // 'pool' or 'solo'
							});
						}
						
						// Sort each pool's blocks
						for (var pool in poolBlocks) {
							poolBlocks[pool].sort((a, b) => b.height - a.height);
						}
					}
					
					res.header('Content-Type', 'application/json');
					res.end(JSON.stringify(poolBlocks));
					
					var duration = Date.now() - blockStart;
					var totalBlocks = data ? Object.keys(data).length : 0;
					logger.debug(logSystem, 'Response', 'Blocks data served - ' + totalBlocks + ' blocks');
					trackRequest('blocks', duration);
				});
				break;
                
            case 'payments':
                var poolBlocks = [];
                var blockCount = 0;
                
                for(var pool in portalStats.stats.pools) {
                    var payments = portalStats.stats.pools[pool].payments;
                    // Limit to last 25 payments (most recent)
                    if (payments && payments.length > 25) {
                        payments = payments.slice(-25);
                    }
                    blockCount += payments ? payments.length : 0;
                    poolBlocks.push({
                        name: pool, 
                        pending: portalStats.stats.pools[pool].pending, 
                        payments: payments
                    });
                }
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(poolBlocks));
                
                // Log and track
                var duration = Date.now() - requestStart;
                logger.debug(logSystem, 'Response', 'Payments served in ' + duration + 'ms (' + blockCount + ' payments)');
                trackRequest('payments', duration);
                return;
                
            case 'worker_stats':
				res.header('Content-Type', 'application/json');
				
				var address = req.query.addr || req.query.address || null;
				
				// Fallback parsing if req.query doesn't work
				if (!address && req.url.indexOf("?") > 0) {
					var queryString = req.url.split("?")[1];
					var params = {};
					queryString.split("&").forEach(function(param) {
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
					logger.info(logSystem, 'WorkerStats', 'Stats requested for address: ' + address);
					
					// make sure it is just the miners address
					address = address.split(".")[0];
					var workerStatsStart = Date.now();
					
					// get miners balance along with worker balances
					portalStats.getBalanceByAddress(address, function(balances) {
						// get current round share total
						portalStats.getTotalSharesByAddress(address, function(shares) {
							var totalHash = parseFloat(0.0);
							var totalShares = shares;
							var networkHash = 0;
							var isSoloMiner = false;
							var workerCount = 0;
							var soloWorkerCount = 0;
							
							// Check history for both regular and solo workers
							for (var h in portalStats.statHistory) {
								for(var pool in portalStats.statHistory[h].pools) {
									// Check regular workers
									for(var w in portalStats.statHistory[h].pools[pool].workers){
										if (w.startsWith(address)) {
											if (history[w] == null) {
												history[w] = [];
											}
											if (portalStats.statHistory[h].pools[pool].workers[w].hashrate) {
												history[w].push({
													time: portalStats.statHistory[h].time, 
													hashrate: portalStats.statHistory[h].pools[pool].workers[w].hashrate
												});
											}
										}
									}
									// Check solo workers in history if they exist
									if (portalStats.statHistory[h].pools[pool].soloWorkers) {
										for(var w in portalStats.statHistory[h].pools[pool].soloWorkers){
											if (w.startsWith(address)) {
												if (history[w] == null) {
													history[w] = [];
												}
												if (portalStats.statHistory[h].pools[pool].soloWorkers[w].hashrate) {
													history[w].push({
														time: portalStats.statHistory[h].time, 
														hashrate: portalStats.statHistory[h].pools[pool].soloWorkers[w].hashrate
													});
												}
											}
										}
									}
								}
							}
							
							// Check current stats for both regular and solo workers
							for(var pool in portalStats.stats.pools) {
								// Check regular workers
								for(var w in portalStats.stats.pools[pool].workers){
									if (w.startsWith(address)) {
										workerCount++;
										workers[w] = portalStats.stats.pools[pool].workers[w];
										for (var b in balances.balances) {
											if (w == balances.balances[b].worker) {
												workers[w].paid = balances.balances[b].paid;
												workers[w].balance = balances.balances[b].balance;
											}
										}
										workers[w].balance = (workers[w].balance || 0);
										workers[w].paid = (workers[w].paid || 0);
										totalHash += portalStats.stats.pools[pool].workers[w].hashrate;
										networkHash = portalStats.stats.pools[pool].poolStats.networkHash;
									}
								}
								
								// Check solo workers
								if (portalStats.stats.pools[pool].soloWorkers) {
									for(var w in portalStats.stats.pools[pool].soloWorkers){
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
											workers[w].balance = (workers[w].balance || 0);
											workers[w].paid = (workers[w].paid || 0);
											totalHash += portalStats.stats.pools[pool].soloWorkers[w].hashrate || 0;
											networkHash = portalStats.stats.pools[pool].poolStats.networkHash;
										}
									}
								}
							}
							
							res.end(JSON.stringify({
								miner: address,
								isSoloMiner: isSoloMiner,
								totalHash: totalHash,
								totalShares: totalShares,
								networkHash: networkHash,
								immature: balances.totalImmature,
								balance: balances.totalHeld,
								paid: balances.totalPaid,
								workers: workers,
								history: history
							}));
							
							// Log completion
							var duration = Date.now() - workerStatsStart;
							logger.info(logSystem, 'WorkerStats', 
								'Stats for ' + address + ' served in ' + duration + 'ms - ' +
								'Workers: ' + workerCount + ' pool, ' + soloWorkerCount + ' solo, ' +
								'Hashrate: ' + (totalHash / 1000000).toFixed(2) + ' MH/s');
							trackRequest('worker_stats', duration);
						});
					});
				} else {
					// Log error
					logger.warning(logSystem, 'WorkerStats', 'Invalid or missing address parameter');
					res.end(JSON.stringify({result: "error", message: "Invalid address"}));
					trackRequest('worker_stats', Date.now() - requestStart, true);
				}
				return;
                
            case 'live_stats':
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'X-Accel-Buffering': 'no'
                });
                
                // Send initial comment to establish connection
                //res.write('***sha256-mining.go.ro***\n*******mining pool*******\n       live stats\n\n');
                
                var uid = Math.random().toString();
                _this.liveStatConnections[uid] = res;
                
                // Log new live connection
                logger.info(logSystem, 'LiveStats', 
                    'New live stats connection: ' + uid + ' from ' + (req.ip || req.connection.remoteAddress) + 
                    ' (Total connections: ' + Object.keys(_this.liveStatConnections).length + ')');
                
                // Send initial stats if available
                if (portalStats.stats) {
                    res.write('data: ' + JSON.stringify(portalStats.stats) + '\n\n');
                }
                
                // Only call flush if it exists
                if (typeof res.flush === 'function') {
                    res.flush();
                }
                
                req.on("close", function() {
                    delete _this.liveStatConnections[uid];
                    
                    // Log disconnection
                    logger.debug(logSystem, 'LiveStats', 
                        'Connection closed: ' + uid + 
                        ' (Remaining: ' + Object.keys(_this.liveStatConnections).length + ')');
                });
                
                trackRequest('live_stats', 0);
                return;
                
            default:
                // Log unknown method
                logger.warning(logSystem, 'Request', 'Unknown API method: ' + method);
                trackRequest('unknown', Date.now() - requestStart, true);
                next();
        }
    };

    this.handleAdminApiRequest = function(req, res, next){
        var method = req.params.method;
        var requestStart = Date.now();
        
        // Log admin request
        logger.warning(logSystem, 'Admin', 'Admin API request: ' + method + ' from ' + (req.ip || req.connection.remoteAddress));
        
        switch(method){
            case 'pools':
                res.end(JSON.stringify({result: poolConfigs}));
                
                // Log completion
                var duration = Date.now() - requestStart;
                logger.info(logSystem, 'Admin', 'Pool configs served in ' + duration + 'ms');
                trackRequest('admin_pools', duration);
                return;
                
            default:
                logger.warning(logSystem, 'Admin', 'Unknown admin method: ' + method);
                trackRequest('admin_unknown', Date.now() - requestStart, true);
                next();
        }
    };
    
    // API stats summary (log every 5 minutes if there's activity)
    setInterval(function() {
        if (Object.keys(apiStats.requests).length > 0) {
            var totalRequests = Object.values(apiStats.requests).reduce((a, b) => a + b, 0);
            var topMethods = Object.entries(apiStats.requests)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([method, count]) => method + '(' + count + ')')
                .join(', ');
            
            var avgResponseTime = apiStats.lastHour.length > 0 ?
                apiStats.lastHour.reduce((sum, r) => sum + r.duration, 0) / apiStats.lastHour.length : 0;
            
            logger.info(logSystem, 'Stats', 
                'API requests - Total: ' + totalRequests + 
                ', Errors: ' + apiStats.errors + 
                ', Top methods: ' + topMethods + 
                ', Avg response: ' + avgResponseTime.toFixed(0) + 'ms' +
                ', Live connections: ' + Object.keys(_this.liveStatConnections).length);
        }
    }, 300000); // Every 5 minutes

};