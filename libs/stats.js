var redis = require('redis');
var async = require('async');

var algos = require('stratum-pool/lib/algoProperties.js');

// redis callback Ready check failed bypass trick
function rediscreateClient(port, host, pass) {
    var client = redis.createClient(port, host);
    if (pass) {
        client.auth(pass);
    }
    return client;
}


/**
 * Sort object properties (only own properties will be sorted).
 * @param {object} obj object to sort properties
 * @param {string|int} sortedBy 1 - sort object properties by specific value.
 * @param {bool} isNumericSort true - sort object properties as numeric value, false - sort as string value.
 * @param {bool} reverse false - reverse sorting.
 * @returns {Array} array of items in [[key,value],[key,value],...] format.
 */
function sortProperties(obj, sortedBy, isNumericSort, reverse) {
	sortedBy = sortedBy || 1; // by default first key
	isNumericSort = isNumericSort || false; // by default text sort
	reverse = reverse || false; // by default no reverse

	var reversed = (reverse) ? -1 : 1;

	var sortable = [];
	for (var key in obj) {
		if (obj.hasOwnProperty(key)) {
			sortable.push([key, obj[key]]);
		}
	}
	if (isNumericSort)
		sortable.sort(function (a, b) {
			return reversed * (a[1][sortedBy] - b[1][sortedBy]);
		});
	else
		sortable.sort(function (a, b) {
			var x = a[1][sortedBy].toLowerCase(),
				y = b[1][sortedBy].toLowerCase();
			return x < y ? reversed * -1 : x > y ? reversed : 0;
		});
	return sortable; // array in format [ [ key1, val1 ], [ key2, val2 ], ... ]
}

module.exports = function(logger, portalConfig, poolConfigs){

    var _this = this;

    var logSystem = 'Stats';

    var redisClients = [];
    var redisStats;

    this.statHistory = [];
    this.statPoolHistory = [];

    this.stats = {};
    this.statsString = '';

    setupStatsRedis();
    gatherStatHistory();

    var canDoStats = true;

    Object.keys(poolConfigs).forEach(function(coin){
        if (!canDoStats) return;

        var poolConfig = poolConfigs[coin];
        var redisConfig = poolConfig.redis;

        for (var i = 0; i < redisClients.length; i++){
            var client = redisClients[i];
            if (client.client.port === redisConfig.port && client.client.host === redisConfig.host){
                client.coins.push(coin);
                return;
            }
        }
        redisClients.push({
            coins: [coin],
            client: rediscreateClient(redisConfig.port, redisConfig.host, redisConfig.password)
        });
    });

    function setupStatsRedis(){
        redisStats = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
        redisStats.on('error', function(err){
        redisStats.auth(portalConfig.redis.password);
        });
    }

this.getBlocks = function (cback) {
    var allBlocks = {};
    
    async.each(Object.keys(_this.stats.pools), function(poolName, pcb) {
        var pool = _this.stats.pools[poolName];
        
        // Get pool pending blocks
        if (pool.poolPending && pool.poolPending.blocks) {
            for (var i = 0; i < pool.poolPending.blocks.length; i++) {
                var blockData = pool.poolPending.blocks[i];
                var blockId = poolName + "-" + blockData.split(':')[2];
                allBlocks[blockId] = {
                    pool: poolName,
                    type: 'pool',
                    status: 'pending',
                    data: blockData
                };
            }
        }
        
        // Get pool confirmed blocks
        if (pool.poolConfirmed && pool.poolConfirmed.blocks) {
            for (var i = 0; i < pool.poolConfirmed.blocks.length; i++) {
                var blockData = pool.poolConfirmed.blocks[i];
                var blockId = poolName + "-" + blockData.split(':')[2];
                allBlocks[blockId] = {
                    pool: poolName,
                    type: 'pool',
                    status: 'confirmed',
                    data: blockData
                };
            }
        }
        
        // Get solo pending blocks
        if (pool.soloPending && pool.soloPending.blocks) {
            for (var i = 0; i < pool.soloPending.blocks.length; i++) {
                var blockData = pool.soloPending.blocks[i];
                var blockId = poolName + "-solo-" + blockData.split(':')[2];
                allBlocks[blockId] = {
                    pool: poolName,
                    type: 'solo',
                    status: 'pending',
                    data: blockData
                };
            }
        }
        
        // Get solo confirmed blocks
        if (pool.soloConfirmed && pool.soloConfirmed.blocks) {
            for (var i = 0; i < pool.soloConfirmed.blocks.length; i++) {
                var blockData = pool.soloConfirmed.blocks[i];
                var blockId = poolName + "-solo-" + blockData.split(':')[2];
                allBlocks[blockId] = {
                    pool: poolName,
                    type: 'solo',
                    status: 'confirmed',
                    data: blockData
                };
            }
        }
        
        pcb();
    }, function(err) {
        cback(allBlocks);
    });
};

    function gatherStatHistory(){
        var retentionTime = (((Date.now() / 1000) - portalConfig.website.stats.historicalRetention) | 0).toString();
        redisStats.zrangebyscore(['statHistory', retentionTime, '+inf'], function(err, replies){
            if (err) {
                logger.error(logSystem, 'Historics', 'Error when trying to grab historical stats ' + JSON.stringify(err));
                return;
            }
            for (var i = 0; i < replies.length; i++){
                _this.statHistory.push(JSON.parse(replies[i]));
            }
            _this.statHistory = _this.statHistory.sort(function(a, b){
                return a.time - b.time;
            });
            _this.statHistory.forEach(function(stats){
                addStatPoolHistory(stats);
            });
        });
    }

	function getWorkerStats(address) {
		address = address.split(".")[0];
		if (address.length > 0 && address.startsWith('t')) {
			for (var h in statHistory) {
				for(var pool in statHistory[h].pools) {

					statHistory[h].pools[pool].workers.sort(sortWorkersByHashrate);

					for(var w in statHistory[h].pools[pool].workers){
						if (w.startsWith(address)) {
							if (history[w] == null) {
								history[w] = [];
							}
							if (workers[w] == null && stats.pools[pool].workers[w] != null) {
								workers[w] = stats.pools[pool].workers[w];
							}
							if (statHistory[h].pools[pool].workers[w].hashrate) {
								history[w].push({time: statHistory[h].time, hashrate:statHistory[h].pools[pool].workers[w].hashrate});
							}
						}
					}
				}
			}
			return JSON.stringify({"workers": workers, "history": history});
		}
		return null;
	}

	function addStatPoolHistory(stats){
		var data = {
			time: stats.time,
			pools: {}
		};
		for (var pool in stats.pools){
			data.pools[pool] = {
				hashrate: stats.pools[pool].hashrate,
				workerCount: stats.pools[pool].workerCount,
				blocks: stats.pools[pool].blocks,
				soloBlocks: stats.pools[pool].soloBlocks || { pending: 0, confirmed: 0, orphaned: 0 }  // ADD THIS
			}
		}
		_this.statPoolHistory.push(data);
	}

    var magnitude = 100000000;
    var coinPrecision = magnitude.toString().length - 1;

    function roundTo(n, digits) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test =(Math.round(n) / multiplicator);
        return +(test.toFixed(digits));
    }

    var satoshisToCoins = function(satoshis){
        return roundTo((satoshis / magnitude), coinPrecision);
    };

    var coinsToSatoshies = function(coins){
        return Math.round(coins * magnitude);
    };

    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    function readableSeconds(t) {
        var seconds = Math.round(t);
        var minutes = Math.floor(seconds/60);
        var hours = Math.floor(minutes/60);
        var days = Math.floor(hours/24);
        hours = hours-(days*24);
        minutes = minutes-(days*24*60)-(hours*60);
        seconds = seconds-(days*24*60*60)-(hours*60*60)-(minutes*60);
        if (days > 0) { return (days + "d " + hours + "h " + minutes + "m " + seconds + "s"); }
        if (hours > 0) { return (hours + "h " + minutes + "m " + seconds + "s"); }
        if (minutes > 0) {return (minutes + "m " + seconds + "s"); }
        return (seconds + "s");
    }

    this.getCoins = function(cback){
        _this.stats.coins = redisClients[0].coins;
        cback();
    };

    this.getPayout = function(address, cback){
        async.waterfall([
            function(callback){
                _this.getBalanceByAddress(address, function(){
                    callback(null, 'test');
                });
            }
        ], function(err, total){
            cback(coinsRound(total).toFixed(8));
        });
    };

	this.getTotalSharesByAddress = function(address, cback) {
	    var a = address.split(".")[0];
        var client = redisClients[0].client,
            coins = redisClients[0].coins,
            shares = [];

        var pindex = parseInt(0);
		var totalShares = parseFloat(0);
		async.each(_this.stats.pools, function(pool, pcb) {
            pindex++;
			var coin = String(_this.stats.pools[pool.name].name);
			client.hscan(coin + ':shares:roundCurrent', 0, "match", a+"*", "count", 1000, function(error, result) {
                if (error) {
                    pcb(error);
                    return;
                }
				var workerName="";
				var shares = 0;
				for (var i in result[1]) {
					if (Math.abs(i % 2) != 1) {
						workerName = String(result[1][i]);
					} else {
						shares += parseFloat(result[1][i]);
					}
				}
                if (shares>0) {
                    totalShares = shares;
                }
                pcb();
			});
		}, function(err) {
            if (err) {
                cback(0);
                return;
            }
            if (totalShares > 0 || (pindex >= Object.keys(_this.stats.pools).length)) {
                cback(totalShares);
                return;
            }
		});
	};

    this.getBalanceByAddress = function(address, cback){

	    var a = address.split(".")[0];

        var client = redisClients[0].client,
            coins = redisClients[0].coins,
            balances = [];

		var totalHeld = parseFloat(0);
		var totalPaid = parseFloat(0);
        var totalImmature = parseFloat(0);

		async.each(_this.stats.pools, function(pool, pcb) {
			var coin = String(_this.stats.pools[pool.name].name);
			// get all immature balances from address
			client.hscan(coin + ':immature', 0, "match", a+"*", "count", 10000, function(error, pends) {
                // get all balances from address
                client.hscan(coin + ':balances', 0, "match", a+"*", "count", 10000, function(error, bals) {
                    // get all payouts from address
                    client.hscan(coin + ':payouts', 0, "match", a+"*", "count", 10000, function(error, pays) {

                        var workerName = "";
                        var balAmount = 0;
                        var paidAmount = 0;
                        var pendingAmount = 0;

                        var workers = {};

                        for (var i in pays[1]) {
                            if (Math.abs(i % 2) != 1) {
                                workerName = String(pays[1][i]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                paidAmount = parseFloat(pays[1][i]);
                                workers[workerName].paid = coinsRound(paidAmount);
                                totalPaid += paidAmount;
                            }
                        }
                        for (var b in bals[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(bals[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                balAmount = parseFloat(bals[1][b]);
                                workers[workerName].balance = coinsRound(balAmount);
                                totalHeld += balAmount;
                            }
                        }
                        for (var b in pends[1]) {
                            if (Math.abs(b % 2) != 1) {
                                workerName = String(pends[1][b]);
                                workers[workerName] = (workers[workerName] || {});
                            } else {
                                pendingAmount = parseFloat(pends[1][b]);
                                workers[workerName].immature = coinsRound(pendingAmount);
                                totalImmature += pendingAmount;
                            }
                        }

                        for (var w in workers) {
                            balances.push({
                                worker:String(w),
                                balance:workers[w].balance,
                                paid:workers[w].paid,
                                immature:workers[w].immature
                            });
                        }

                        pcb();
                    });
                });
            });
		}, function(err) {
			if (err) {
				callback("There was an error getting balances");
				return;
			}

			_this.stats.balances = balances;
			_this.stats.address = address;

			cback({totalHeld:coinsRound(totalHeld), totalPaid:coinsRound(totalPaid), totalImmature:satoshisToCoins(totalImmature), balances});
		});
	};

    this.getGlobalStats = function(callback){

        var statGatherTime = Date.now() / 1000 | 0;

        var allCoinStats = {};

        async.each(redisClients, function(client, callback){
            var windowTime = (((Date.now() / 1000) - portalConfig.website.stats.hashrateWindow) | 0).toString();
            var redisCommands = [];

			var redisCommandTemplates = [
				['zremrangebyscore', ':hashrate', '-inf', '(' + windowTime],
				['zrangebyscore', ':hashrate', windowTime, '+inf'],
				['hgetall', ':stats'],
				['scard', ':blocksPending'],
				['scard', ':blocksConfirmed'],
				['scard', ':blocksKicked'],
				['smembers', ':blocksPending'],
				['smembers', ':blocksConfirmed'],
				['hgetall', ':shares:roundCurrent'],
				['hgetall', ':shares:roundCurrent:solo'],
				['zrangebyscore', ':hashrate:solo', windowTime, '+inf'],
				['hgetall', ':blocksPendingConfirms'],
				['zrevrange', ':payments', 0, 99],
				['hgetall', ':shares:timesCurrent'],
				// ADD THESE NEW COMMANDS FOR SOLO BLOCKS
				['scard', ':blocksPending:solo'],      // index 14
				['scard', ':blocksConfirmed:solo'],     // index 15
				['scard', ':blocksKicked:solo'],        // index 16
				['smembers', ':blocksPending:solo'],    // index 17
				['smembers', ':blocksConfirmed:solo']   // index 18
			];

						//var commandsPerCoin = redisCommandTemplates.length;
						var commandsPerCoin = 19; // Hardcode this to be sure
						
						// ENHANCED: Solo mining data indices
						var soloSharesIndex = 9;        // :shares:roundCurrent:solo position
						var soloHashrateIndex = 10;     // :hashrate:solo position
						//console.log('Redis client coins array:', JSON.stringify(client.coins));
						//console.log('Array length:', client.coins.length);

            client.coins.map(function(coin){
                redisCommandTemplates.map(function(t){
                    var clonedTemplates = t.slice(0);
                    clonedTemplates[1] = coin + clonedTemplates[1];
                    redisCommands.push(clonedTemplates);
                });
            });

		function getLastBlock(blocks) {
		  if (!Array.isArray(blocks) || blocks.length === 0) return null;

		  return blocks.reduce((latest, block) => {
		    const latestTimestamp = parseInt(latest.split(':')[4], 10);
		    const currentTimestamp = parseInt(block.split(':')[4], 10);
		    return currentTimestamp > latestTimestamp ? block : latest;
		  });
		}
		
			client.client.multi(redisCommands).exec(function(err, replies){
				if (err){
					logger.error(logSystem, 'Global', 'error with getting global stats ' + JSON.stringify(err));
					callback(err);
				}
				else{
					//console.log('=== DEBUG: Processing coins ===');
					//console.log('Coins to process:', client.coins);
					//console.log('Total replies length:', replies.length);
					//console.log('Commands per coin:', commandsPerCoin);
					//console.log('Expected replies:', client.coins.length * commandsPerCoin);
					// Fix: Only process actual coins, not undefined entries
					for(var i = 0; i < client.coins.length * commandsPerCoin; i += commandsPerCoin){
						var coinIndex = Math.floor(i / commandsPerCoin);
						var coinName = client.coins[coinIndex];
						//console.log('Processing coin:', coinName, 'at index:', coinIndex, 'reply index:', i);				
						// Skip if no coin name or config
						if (!coinName || !poolConfigs[coinName]) {
							continue;
						}
					               					
						const isValidBlock = Array.isArray(replies[i + 6]) && Array.isArray(replies[i + 7]);
						const combinedReplies = isValidBlock ? [...replies[i + 7], ...replies[i + 6]] : null;

						const PendingBlocks = (replies[i + 6] || []).sort(sortBlocks);
						const ConfirmedBlocks = (replies[i + 7] || []).sort(sortBlocks).slice(0, 50);

						// Solo block details (actual block data)
						const soloPendingBlocks = (replies[i + 17] || []).sort(sortBlocks);
						const soloConfirmedBlocks = (replies[i + 18] || []).sort(sortBlocks).slice(0, 50);
						const allSoloBlocks = [...(replies[i + 18] || []), ...(replies[i + 17] || [])];

						// Get the most recent block from either pool or solo
						const lastPoolBlockStr = combinedReplies ? getLastBlock(combinedReplies) : null;
						const lastSoloBlockStr = allSoloBlocks.length > 0 ? getLastBlock(allSoloBlocks) : null;

						// Determine which block is more recent
						let lastBlockStr = null;
						if (lastPoolBlockStr && lastSoloBlockStr) {
							const poolTime = parseInt(lastPoolBlockStr.split(':')[4], 10);
							const soloTime = parseInt(lastSoloBlockStr.split(':')[4], 10);
							lastBlockStr = poolTime > soloTime ? lastPoolBlockStr : lastSoloBlockStr;
						} else {
							lastBlockStr = lastPoolBlockStr || lastSoloBlockStr;
						}

						const blocks = {
							pending: (replies[i + 3] || 0) + (replies[i + 14] || 0),      // Pool pending + Solo pending
							confirmed: (replies[i + 4] || 0) + (replies[i + 15] || 0),    // Pool confirmed + Solo confirmed  
							orphaned: (replies[i + 5] || 0) + (replies[i + 16] || 0),     // Pool orphaned + Solo orphaned
							lastblock: lastBlockStr ? parseInt(lastBlockStr.split(':')[2], 10) : null,
							lastblock_time: lastBlockStr ? parseInt(lastBlockStr.split(':')[4], 10) : null
						};

						// Separate counts for display purposes
						const poolBlocks = {
							pending: replies[i + 3] || 0,
							confirmed: replies[i + 4] || 0,
							orphaned: replies[i + 5] || 0,
							lastblock: lastPoolBlockStr ? parseInt(lastPoolBlockStr.split(':')[2], 10) : null,
							lastblock_time: lastPoolBlockStr ? parseInt(lastPoolBlockStr.split(':')[4], 10) : null
						};

						const soloBlocks = {
							pending: replies[i + 14] || 0,
							confirmed: replies[i + 15] || 0,
							orphaned: replies[i + 16] || 0,
							lastblock: lastSoloBlockStr ? parseInt(lastSoloBlockStr.split(':')[2], 10) : null,
							lastblock_time: lastSoloBlockStr ? parseInt(lastSoloBlockStr.split(':')[4], 10) : null
						};

						var coinStats = {
							name: coinName,
							symbol: poolConfigs[coinName].coin.symbol.toUpperCase(),
							algorithm: poolConfigs[coinName].coin.algorithm,
							blockTime: poolConfigs[coinName].coin.blockTime,
							poolType: (poolConfigs[coinName]?.paymentProcessing?.soloMining === true) ? "prop+solo" : "prop",
							soloMining: poolConfigs[coinName]?.paymentProcessing?.soloMining || false,
							paymentMode: poolConfigs[coinName]?.paymentProcessing?.paymentMode || 0,
							minimumPayment: poolConfigs[coinName]?.paymentProcessing?.minimumPayment || 0,
							poolFee: poolConfigs[coinName]?.paymentProcessing?.poolFee || 0,
							soloFee: poolConfigs[coinName]?.paymentProcessing?.soloFee || 0,
							hashrates: replies[i + 1],
							poolStats: {
								validShares: replies[i + 2] ? (replies[i + 2].validShares || 0) : 0,
								validBlocks: replies[i + 2] ? (replies[i + 2].validBlocks || 0) : 0,
								invalidShares: replies[i + 2] ? (replies[i + 2].invalidShares || 0) : 0,
								totalPaid: replies[i + 2] ? (replies[i + 2].totalPaid || 0) : 0,
								networkBlocks: replies[i + 2] ? (replies[i + 2].networkBlocks || 0) : 0,
								networkHash: replies[i + 2] ? (replies[i + 2].networkHash || 0) : 0,
								networkHashString: getReadableNetworkHashRateString(replies[i + 2] ? (replies[i + 2].networkHash || 0) : 0),
								networkDiff: replies[i + 2] ? (replies[i + 2].networkDiff || 0) : 0,
								networkConnections: replies[i + 2] ? (replies[i + 2].networkConnections || 0) : 0,
								networkVersion: replies[i + 2] ? (replies[i + 2].networkSubVersion || replies[i + 2].networkVersion) : 0,
								networkProtocolVersion: replies[i + 2] ? (replies[i + 2].networkProtocolVersion || 0) : 0
							},

							blocks: blocks,           // Total combined blocks
							poolBlocks: poolBlocks,   // Pool-only blocks  
							soloBlocks: soloBlocks,   // Solo-only blocks
							
							poolPending: {
								blocks: PendingBlocks,
								confirms: (replies[i + 11] || {})
							},
							poolConfirmed: {
								blocks: ConfirmedBlocks
							},
															
							soloPending: {
								blocks: soloPendingBlocks,
								confirms: (replies[i + 11] || {})
							},
							soloConfirmed: {
								blocks: soloConfirmedBlocks
							},
														
                            payments: [],
							currentRoundShares: (replies[i + 8] || {}),
							currentRoundSharesSolo: (replies[i + soloSharesIndex] || {}),  // NEW
							soloHashrates: replies[i + soloHashrateIndex],                 // NEW
							currentRoundTimes: (replies[i + 11] || {}),
                            	currentRoundTimes: (replies[i + 11] || {}),
                            	maxRoundTime: 0,
                            	shareCount: 0
                        };
						// Process payments data
						coinStats.payments = [];
						var paymentsData = replies[i + 12];

						if (paymentsData && Array.isArray(paymentsData)) {
							// Process payments, ensuring we handle them correctly
							for (var j = 0; j < paymentsData.length && j < 100; j++) {
								try {
									var payment = JSON.parse(paymentsData[j]);
									
									// Validate payment object has required fields
									if (payment && payment.time) {
										// Ensure all required fields exist with defaults
										payment.blocks = payment.blocks || '';
										payment.miners = payment.miners || 0;
										payment.shares = payment.shares || 0;
										payment.amounts = payment.amounts || {};
										payment.paid = payment.paid || 0;
										payment.txid = payment.txid || '';
										payment.isSolo = payment.isSolo || false;  
										
										coinStats.payments.push(payment);
									}
								} catch(e) {
									// Silent error handling - invalid payment data is skipped
								}
							}
							
							// Sort payments by time (newest first)
							coinStats.payments.sort(function(a, b) {
								return (b.time || 0) - (a.time || 0);
							});
							
							// Keep only 25 most recent for display
							coinStats.payments = coinStats.payments.slice(0, 25);
						}
                        allCoinStats[coinStats.name] = (coinStats);
                    }
                    // sort pools alphabetically
                    allCoinStats = sortPoolsByName(allCoinStats);
                    callback();
                }
            });
        }, function(err){
            if (err){
                logger.error(logSystem, 'Global', 'error getting all stats' + JSON.stringify(err));
                callback();
                return;
            }

				var portalStats = {
					time: statGatherTime,
					global:{
						miners: 0,
						workers: 0, 						
						poolMiners: 0,    
						soloMiners: 0,
						hashrate: 0,
						hashrateString: null
					},
					algos: {},
					pools: allCoinStats
				};

            Object.keys(allCoinStats).forEach(function(coin){
                var coinStats = allCoinStats[coin];
                coinStats.workers = {};
				coinStats.miners = {};
				coinStats.soloWorkers = {};  // NEW - Initialize solo workers object
				coinStats.poolShares = 0;  
				coinStats.soloShares = 0;  
                coinStats.shares = 0;
                coinStats.hashrates.forEach(function(ins){
                    var parts = ins.split(':');
                    var workerShares = parseFloat(parts[0]);
					var miner = parts[1].split('.')[0];
                    var worker = parts[1];
					var diff = Math.round(parts[0] * 8192);
                    if (workerShares > 0) {
						coinStats.poolShares += workerShares;
                        coinStats.shares += workerShares;
						// build worker stats
                        if (worker in coinStats.workers) {
                            coinStats.workers[worker].shares += workerShares;
							coinStats.workers[worker].diff = diff;
                        } else {
                            coinStats.workers[worker] = {
								name: worker,
								diff: diff,
                                shares: workerShares,
                                invalidshares: 0,
								currRoundShares: 0,
                                currRoundTime: 0,
								hashrate: null,
                                hashrateString: null,
								luckDays: null,
								luckHours: null,
								paid: 0,
								balance: 0
                            };
						}
						// build miner stats
						if (miner in coinStats.miners) {
							coinStats.miners[miner].shares += workerShares;
						} else {
							coinStats.miners[miner] = {
								name: miner,
								shares: workerShares,
								invalidshares: 0,
								currRoundShares: 0,
				                                currRoundTime: 0,
								hashrate: null,
								hashrateString: null,
								luckDays: null,
								luckHours: null
							};
						}
                    }
                    else {
						// build worker stats
                        if (worker in coinStats.workers) {
                            coinStats.workers[worker].invalidshares -= workerShares; // workerShares is negative number!
							coinStats.workers[worker].diff = diff;
                        } else {
                            coinStats.workers[worker] = {
								name: worker,
								diff: diff,
                                shares: 0,
								invalidshares: -workerShares,
								currRoundShares: 0,
                                currRoundTime: 0,
								hashrate: null,
                                hashrateString: null,
								luckDays: null,
								luckHours: null,
								paid: 0,
								balance: 0
                            };
						}
						// build miner stats
						if (miner in coinStats.miners) {
							coinStats.miners[miner].invalidshares -= workerShares; // workerShares is negative number!
						} else {
							coinStats.miners[miner] = {
								name: miner,
								shares: 0,
								invalidshares: -workerShares,
								currRoundShares: 0,
                                currRoundTime: 0,
								hashrate: null,
								hashrateString: null,
								luckDays: null,
								luckHours: null
							};
						}
                    }
                });
			//	console.log('Pool:', coinStats.name, 'currentRoundShares:', Object.keys(coinStats.currentRoundShares));
                // For PROP pools, include all miners with currentRoundShares
                if (coinStats.paymentMode === 'prop') {
                    for (var worker in coinStats.currentRoundShares) {
                        var miner = worker.split(".")[0];
                        var shareAmount = parseFloat(coinStats.currentRoundShares[worker]);
                        
                        // Only add if not already in workers (from hashrate data)
                        if (!(worker in coinStats.workers)) {
                            coinStats.workers[worker] = {
                                name: worker,
                                diff: 0,
                                shares: 0,
                                invalidshares: 0,
                                currRoundShares: shareAmount,
                                currRoundTime: 0,
                                hashrate: 0,
                                hashrateString: "0 H/s",
                                luckDays: "Infinity",
                                luckHours: "Infinity",
                                luckMinute: "Infinity",
                                paid: 0,
                                balance: 0
                            };
                        }
                        
                        // Add to miners if not already present
                        if (!(miner in coinStats.miners)) {
                            coinStats.miners[miner] = {
                                name: miner,
                                shares: 0,
                                invalidshares: 0,
                                currRoundShares: shareAmount,
                                currRoundTime: 0,
                                hashrate: 0,
                                hashrateString: "0 H/s",
                                luckDays: "Infinity",
                                luckHours: "Infinity",
                                luckMinute: "Infinity"
                            };
                        }
                    }
                }
				
								// ENHANCED: Process solo miners
				if (coinStats.soloHashrates && coinStats.soloHashrates.length > 0) {
					coinStats.soloHashrates.forEach(function(ins){
						var parts = ins.split(':');
						var workerShares = parseFloat(parts[0]);
						var miner = parts[1].split('.')[0];
						var worker = parts[1];
						var diff = Math.round(parts[0] * 8192);
						
						if (workerShares > 0) {
							coinStats.soloShares += workerShares;
							coinStats.shares += workerShares;
							// build solo worker stats
							if (worker in coinStats.soloWorkers) {
								coinStats.soloWorkers[worker].shares += workerShares;
								coinStats.soloWorkers[worker].diff = diff;
							} else {
								coinStats.soloWorkers[worker] = {
									name: worker,
									diff: diff,
									shares: workerShares,
									invalidshares: 0,
									currRoundShares: 0,
									currRoundTime: 0,
									hashrate: null,
									hashrateString: null,
									luckDays: null,
									luckHours: null,
									paid: 0,
									balance: 0,
									isSolo: true  // Flag to identify solo miners
								};
							}
						} else {
							// handle invalid solo shares
							if (worker in coinStats.soloWorkers) {
								coinStats.soloWorkers[worker].invalidshares -= workerShares;
								coinStats.soloWorkers[worker].diff = diff;
							} else {
								coinStats.soloWorkers[worker] = {
									name: worker,
									diff: diff,
									shares: 0,
									invalidshares: -workerShares,
									currRoundShares: 0,
									currRoundTime: 0,
									hashrate: null,
									hashrateString: null,
									luckDays: null,
									luckHours: null,
									paid: 0,
									balance: 0,
									isSolo: true
								};
							}
						}
					});
				}

				// sort miners
				coinStats.miners = sortMinersByHashrate(coinStats.miners);

				var shareMultiplier = Math.pow(2, 32) / algos[coinStats.algorithm].multiplier;
				// Calculate pool hashrate from pool shares only
				coinStats.hashrate = shareMultiplier * (coinStats.poolShares || 0) / portalConfig.website.stats.hashrateWindow;
				coinStats.hashrateString = _this.getReadableHashRateString(coinStats.hashrate);

                var _blocktime = coinStats.blockTime || 90;
				var _networkHashRate = parseFloat(coinStats.poolStats.networkHash);
				coinStats.luckDays =  ((_networkHashRate / coinStats.hashrate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                coinStats.luckHours = ((_networkHashRate / coinStats.hashrate * _blocktime) / (60 * 60)).toFixed(3);
                coinStats.luckMinute = ((_networkHashRate / coinStats.hashrate * _blocktime) / (60)).toFixed(3);
				// Count pool miners (addresses in miners that are not in soloWorkers)
				var poolMinerCount = 0;
				for (var miner in coinStats.miners) {
					var minerAddress = miner.split('.')[0];
					var isSolo = false;
					// Check if this miner address has any solo workers
					for (var worker in coinStats.soloWorkers) {
						if (worker.startsWith(minerAddress)) {
							isSolo = true;
							break;
						}
					}
					if (!isSolo) {
						poolMinerCount++;
					}
				}
				coinStats.poolMinerCount = poolMinerCount;
				coinStats.minerCount = coinStats.poolMinerCount;  // Keep for compatibility
                coinStats.workerCount = Object.keys(coinStats.workers).length;
				
				// ENHANCED: Calculate solo worker hashrates and luck
				for (var worker in coinStats.soloWorkers) {
					var _workerRate = shareMultiplier * coinStats.soloWorkers[worker].shares / portalConfig.website.stats.hashrateWindow;
					coinStats.soloWorkers[worker].luckDays = ((_networkHashRate / _workerRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
					coinStats.soloWorkers[worker].luckHours = ((_networkHashRate / _workerRate * _blocktime) / (60 * 60)).toFixed(3);
					coinStats.soloWorkers[worker].luckMinute = ((_networkHashRate / _workerRate * _blocktime) / (60)).toFixed(3);
					coinStats.soloWorkers[worker].hashrate = _workerRate;
					coinStats.soloWorkers[worker].hashrateString = _this.getReadableHashRateString(_workerRate);
				}
				
				// Calculate total solo hashrate and count 
				var totalSoloHashrate = 0;
				var totalSoloWorkers = 0;

				for (var worker in coinStats.soloWorkers) {
					totalSoloHashrate += coinStats.soloWorkers[worker].hashrate || 0;
					totalSoloWorkers++;
				}

				coinStats.soloHashrate = totalSoloHashrate;
				coinStats.soloHashrateString = _this.getReadableHashRateString(totalSoloHashrate);
				coinStats.soloWorkerCount = totalSoloWorkers;  // - set soloWorkerCount here
				// NOW add to global hashrate AFTER solo hashrate is calculated
				portalStats.global.hashrate += coinStats.hashrate + coinStats.soloHashrate;
				portalStats.global.hashrateString = _this.getReadableHashRateString(portalStats.global.hashrate);
			

			var _shareTotal = parseFloat(0);
                var _maxTimeShare = parseFloat(0);
                for (var worker in coinStats.currentRoundShares) {
                    var miner = worker.split(".")[0];
                    var shareAmount = parseFloat(coinStats.currentRoundShares[worker]);
                    
                    if (miner in coinStats.miners) {
                        coinStats.miners[miner].currRoundShares = (coinStats.miners[miner].currRoundShares || 0) + shareAmount;
                    }
                    if (worker in coinStats.workers) {
                        coinStats.workers[worker].currRoundShares = shareAmount;
                    }
                    _shareTotal += shareAmount;
                }
								// ENHANCED: Process solo current round shares
				for (var worker in coinStats.currentRoundSharesSolo) {
					if (worker in coinStats.soloWorkers) {
						coinStats.soloWorkers[worker].currRoundShares += parseFloat(coinStats.currentRoundSharesSolo[worker]);
					}
					_shareTotal += parseFloat(coinStats.currentRoundSharesSolo[worker]);
				}
                for (var worker in coinStats.currentRoundTimes) {
                    var time = parseFloat(coinStats.currentRoundTimes[worker]);
                    if (_maxTimeShare < time)
                        _maxTimeShare = time;

                    var miner = worker.split(".")[0];
                    if (miner in coinStats.miners) {
                        coinStats.miners[miner].currRoundTime += parseFloat(coinStats.currentRoundTimes[worker]);
                    }
                }

                coinStats.shareCount = _shareTotal;
                coinStats.maxRoundTime = _maxTimeShare;
                coinStats.maxRoundTimeString = readableSeconds(_maxTimeShare);

                for (var worker in coinStats.workers) {
					var _workerRate = shareMultiplier * coinStats.workers[worker].shares / portalConfig.website.stats.hashrateWindow;
					coinStats.workers[worker].luckDays = ((_networkHashRate / _workerRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                    coinStats.workers[worker].luckHours = ((_networkHashRate / _workerRate * _blocktime) / (60 * 60)).toFixed(3);
                    coinStats.workers[worker].luckMinute = ((_networkHashRate / _workerRate * _blocktime) / (60)).toFixed(3);
					coinStats.workers[worker].hashrate = _workerRate;
					coinStats.workers[worker].hashrateString = _this.getReadableHashRateString(_workerRate);
                }

				// Count only ACTIVE workers and miners (those with hashrate > 0)
				var activeWorkerCount = 0;
				var activePoolMinerAddresses = {};
				var activeSoloWorkerCount = 0;
				var activeSoloMinerAddresses = {};

				// Count active pool workers/miners
				for (var worker in coinStats.workers) {
					if (coinStats.workers[worker].hashrate > 0) {
						activeWorkerCount++;
						var minerAddress = worker.split('.')[0];
						activePoolMinerAddresses[minerAddress] = true;
					}
				}

				// Count active solo workers/miners  
				for (var worker in coinStats.soloWorkers) {
					if (coinStats.soloWorkers[worker].hashrate > 0) {
						activeSoloWorkerCount++;
						var minerAddress = worker.split('.')[0];
						activeSoloMinerAddresses[minerAddress] = true;
					}
				}

				// Set the counts to only active miners  

				coinStats.minerCount = Object.keys(activePoolMinerAddresses).length + Object.keys(activeSoloMinerAddresses).length;  // Total of all miners
				coinStats.workerCount = activeWorkerCount + activeSoloWorkerCount;  // NEW: Total of all workers (pool + solo)
				
				coinStats.poolMinerCount = Object.keys(activePoolMinerAddresses).length;  // Pool-only miners for compatibility
				coinStats.poolWorkerCount = activeWorkerCount;  // Keep this as pool-only workers for backwards compatibility
				
				coinStats.soloWorkerCount = activeSoloWorkerCount;  // Solo workers only
				coinStats.soloMinerCount = Object.keys(activeSoloMinerAddresses).length;  // Solo miners only
				
				coinStats.poolHashrate = coinStats.hashrate;  // pool total
				coinStats.poolHashrateString = _this.getReadableHashRateString(coinStats.hashrate);
				
				coinStats.hashrate = coinStats.hashrate + coinStats.soloHashrate;  // Combined total
				coinStats.hashrateString = _this.getReadableHashRateString(coinStats.hashrate);
								
				for (var miner in coinStats.miners) {
					var _workerRate = shareMultiplier * coinStats.miners[miner].shares / portalConfig.website.stats.hashrateWindow;
					coinStats.miners[miner].luckDays = ((_networkHashRate / _workerRate * _blocktime) / (24 * 60 * 60)).toFixed(3);
                    coinStats.miners[miner].luckHours = ((_networkHashRate / _workerRate * _blocktime) / (60 * 60)).toFixed(3);
                    coinStats.miners[miner].luckMinute = ((_networkHashRate / _workerRate * _blocktime) / (60)).toFixed(3);
					coinStats.miners[miner].hashrate = _workerRate;
					coinStats.miners[miner].hashrateString = _this.getReadableHashRateString(_workerRate);
                }

				// sort workers by name
				coinStats.workers = sortWorkersByName(coinStats.workers);

				// ENHANCED: Sort solo workers and clean up solo data
				coinStats.soloWorkers = sortWorkersByName(coinStats.soloWorkers);
				
				/* algorithm specific global stats */
				var algo = coinStats.algorithm;
				if (!portalStats.algos.hasOwnProperty(algo)){
					portalStats.algos[algo] = {
						activeMiners: 0,
						activePoolMiners: 0,        	// Active pool miners
						activeSoloMiners: 0,    		// Active solo miners
						activeWorkers: 0,             	// Total active workers (pool + solo)
						activeSoloWorkers: 0,         	// Active solo workers only
						hashrate: 0,
						hashrateString: null,
						poolHashrate: 0,
						poolHashrateString: null,
						soloHashrate: 0,
						soloHashrateString: null
					};
				}
				
				portalStats.algos[algo].activePoolMiners += coinStats.poolMinerCount;
				portalStats.algos[algo].activeSoloMiners += coinStats.soloMinerCount;
				portalStats.algos[algo].activeWorkers += coinStats.workerCount;
				portalStats.algos[algo].activeSoloWorkers += coinStats.soloWorkerCount;
				portalStats.algos[algo].hashrate += coinStats.hashrate;				
				portalStats.algos[algo].poolHashrate += coinStats.poolHashrate;
				portalStats.algos[algo].soloHashrate += (coinStats.soloHashrate || 0);
				
				// Reorganize coinStats fields by type
				var reorganizedStats = {
					// Basic info
					name: coinStats.name,
					symbol: coinStats.symbol,
					algorithm: coinStats.algorithm,
					blockTime: coinStats.blockTime,
					poolType: coinStats.poolType,
					soloMining: coinStats.soloMining,
					paymentMode: coinStats.paymentMode,
					minimumPayment: coinStats.minimumPayment,
					poolFee: coinStats.poolFee,
					soloFee: coinStats.soloFee,
					
					// Counts grouped together
					minerCount: coinStats.minerCount,
					workerCount: coinStats.workerCount,
					poolMinerCount: coinStats.poolMinerCount,
					poolWorkerCount: coinStats.poolWorkerCount,
					soloMinerCount: coinStats.soloMinerCount,
					soloWorkerCount: coinStats.soloWorkerCount,
					
					// Hashrates grouped together
					hashrate: coinStats.hashrate,
					hashrateString: coinStats.hashrateString,
					poolHashrate: coinStats.poolHashrate,
					poolHashrateString: coinStats.poolHashrateString,
					soloHashrate: coinStats.soloHashrate,
					soloHashrateString: coinStats.soloHashrateString,
					
					// Shares grouped together
					shareCount: coinStats.shareCount,
					poolShares: coinStats.poolShares,
					soloShares: coinStats.soloShares,
					
					// Luck stats
					luckDays: coinStats.luckDays,
					luckHours: coinStats.luckHours,
					luckMinute: coinStats.luckMinute,
					
					// Network stats
					poolStats: coinStats.poolStats,
					
					// Blocks
					blocks: coinStats.blocks,
					poolBlocks: coinStats.poolBlocks,   // Pool-only blocks
					soloBlocks: coinStats.soloBlocks,   // Solo-only blocks
					poolPending: coinStats.poolPending,
					poolConfirmed: coinStats.poolConfirmed,
					soloPending: coinStats.soloPending,
					soloConfirmed: coinStats.soloConfirmed,
					
					// Payments
					payments: coinStats.payments,
					
					// Current round data
					currentRoundShares: coinStats.currentRoundShares,
					currentRoundTimes: coinStats.currentRoundTimes,
					maxRoundTime: coinStats.maxRoundTime,
					maxRoundTimeString: coinStats.maxRoundTimeString,
					
					// Workers and Miners
					miners: coinStats.miners,
					workers: coinStats.workers,
					soloWorkers: coinStats.soloWorkers
				};

				// Replace the original with reorganized
				allCoinStats[coinStats.name] = reorganizedStats;

				delete coinStats.hashrates;
				delete coinStats.soloHashrates;           // NEW - Clean up solo hashrate data
				delete coinStats.currentRoundSharesSolo;  // NEW - Clean up solo current round data  
				delete coinStats.shares;
			});
			
				// Reset global workers count before recalculating
				portalStats.global.workers = 0;
				portalStats.global.miners = 0;        // ADD THIS
				portalStats.global.poolMiners = 0;    // ADD THIS  
				portalStats.global.soloMiners = 0;    // ADD THIS
				
				// For tracking unique miners across all pools:
				var globalUniqueMiners = {
					pool: new Set(),
					solo: new Set()
				};

				// Properly count active workers across all pools
				Object.keys(allCoinStats).forEach(function(coinName) {
					var coin = allCoinStats[coinName];
					var activePoolWorkers = 0;
					var activeSoloWorkers = 0;
					
					// Count only workers with hashrate > 0
					for (var worker in coin.workers) {
						if (coin.workers[worker].hashrate > 0) {
							activePoolWorkers++;
							// Add miner address to global unique set
							var minerAddress = worker.split('.')[0];
							globalUniqueMiners.pool.add(minerAddress);
						}
					}
					
					for (var worker in coin.soloWorkers) {
						if (coin.soloWorkers[worker].hashrate > 0) {
							activeSoloWorkers++;
							// Add miner address to global unique set
							var minerAddress = worker.split('.')[0];
							globalUniqueMiners.solo.add(minerAddress);
						}
					}
					
					// Add to global count
					portalStats.global.workers += activePoolWorkers + activeSoloWorkers;
					
					// Fix algo-level worker counts
					var algo = coin.algorithm;
					if (portalStats.algos[algo]) {
						// Reset and recalculate algo worker counts
						if (!portalStats.algos[algo].workersRecounted) {
							portalStats.algos[algo].activeWorkers = 0;     
							portalStats.algos[algo].activeSoloWorkers = 0; 
							portalStats.algos[algo].workersRecounted = true;
						}
							portalStats.algos[algo].activeWorkers += activePoolWorkers + activeSoloWorkers;
							portalStats.algos[algo].activeSoloWorkers += activeSoloWorkers;
					}
				});
				
				portalStats.global.poolMiners = globalUniqueMiners.pool.size;
				portalStats.global.soloMiners = globalUniqueMiners.solo.size;
				portalStats.global.miners = globalUniqueMiners.pool.size + globalUniqueMiners.solo.size;

				// Clean up the temporary flag
				Object.keys(portalStats.algos).forEach(function(algo) {
					delete portalStats.algos[algo].workersRecounted;
				});

            Object.keys(portalStats.algos).forEach(function(algo){
                var algoStats = portalStats.algos[algo];
				algoStats.activeMiners = algoStats.activePoolMiners + algoStats.activeSoloMiners;
                algoStats.hashrateString = _this.getReadableHashRateString(algoStats.hashrate);
				algoStats.poolHashrateString = _this.getReadableHashRateString(algoStats.poolHashrate || 0);
				algoStats.soloHashrateString = _this.getReadableHashRateString(algoStats.soloHashrate || 0);
            });

            _this.stats = portalStats;

            // save historical hashrate, not entire stats!
			var saveStats = JSON.parse(JSON.stringify(portalStats));
			Object.keys(saveStats.pools).forEach(function(pool){
				delete saveStats.pools[pool].pending;
				delete saveStats.pools[pool].confirmed;
				delete saveStats.pools[pool].currentRoundShares;
				delete saveStats.pools[pool].currentRoundTimes;
				delete saveStats.pools[pool].payments;
				delete saveStats.pools[pool].miners;
				//delete saveStats.pools[pool].workers;
				    if (saveStats.pools[pool].workers) {
					for (var worker in saveStats.pools[pool].workers) {
						saveStats.pools[pool].workers[worker] = {
							hashrate: saveStats.pools[pool].workers[worker].hashrate,
							hashrateString: saveStats.pools[pool].workers[worker].hashrateString
						};
					}
				}
				//delete saveStats.pools[pool].soloWorkers;
					if (saveStats.pools[pool].soloWorkers) {
						for (var worker in saveStats.pools[pool].soloWorkers) {
							saveStats.pools[pool].soloWorkers[worker] = {
								hashrate: saveStats.pools[pool].soloWorkers[worker].hashrate,
								hashrateString: saveStats.pools[pool].soloWorkers[worker].hashrateString
							};
						}
					}
				delete saveStats.pools[pool].soloPending;
				delete saveStats.pools[pool].soloConfirmed;
				// Keep: blocks, soloBlocks, hashrate, workerCount, etc.
			});
            _this.statsString = JSON.stringify(saveStats);
            _this.statHistory.push(saveStats);

			addStatPoolHistory(portalStats);

            var retentionTime = (((Date.now() / 1000) - portalConfig.website.stats.historicalRetention) | 0);

            for (var i = 0; i < _this.statHistory.length; i++){
                if (retentionTime < _this.statHistory[i].time){
                    if (i > 0) {
                        _this.statHistory = _this.statHistory.slice(i);
                        _this.statPoolHistory = _this.statPoolHistory.slice(i);
                    }
                    break;
                }
            }

            redisStats.multi([
                ['zadd', 'statHistory', statGatherTime, _this.statsString],
                ['zremrangebyscore', 'statHistory', '-inf', '(' + retentionTime]
            ]).exec(function(err, replies){
                if (err)
                    logger.error(logSystem, 'Historics', 'Error adding stats to historics ' + JSON.stringify(err));
            });
            callback();
        });

    };

    function sortPoolsByName(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'name', false, false);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
    }

    function sortBlocks(a, b) {
        var as = parseInt(a.split(":")[2]);
        var bs = parseInt(b.split(":")[2]);
        if (as > bs) return -1;
        if (as < bs) return 1;
        return 0;
    }

	function sortWorkersByName(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'name', false, false);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
	}

	function sortMinersByHashrate(objects) {
		var newObject = {};
		var sortedArray = sortProperties(objects, 'shares', true, true);
		for (var i = 0; i < sortedArray.length; i++) {
			var key = sortedArray[i][0];
			var value = sortedArray[i][1];
			newObject[key] = value;
		}
		return newObject;
	}

	function sortWorkersByHashrate(a, b) {
		if (a.hashrate === b.hashrate) {
			return 0;
		}
		else {
			return (a.hashrate < b.hashrate) ? -1 : 1;
		}
	}

    this.getReadableHashRateString = function(hashrate){
		hashrate = (hashrate * 1000000);
		if (hashrate < 1000000) {
			return '0 H/s';
		}
        var byteUnits = [' H/s', ' KH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s', ' EH/s', ' ZH/s', ' YH/s' ];
        var i = Math.floor((Math.log(hashrate/1000) / Math.log(1000)) - 1);
        hashrate = (hashrate/1000) / Math.pow(1000, i + 1);
        return hashrate.toFixed(2) + byteUnits[i];
    };

	function getReadableNetworkHashRateString(hashrate) {
		hashrate = (hashrate * 1000000);
		if (hashrate < 1000000)
			return '0 H/s';
        var byteUnits = [' H/s', ' KH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s', ' EH/s', ' ZH/s', ' YH/s' ];
		var i = Math.floor((Math.log(hashrate/1000) / Math.log(1000)) - 1);
		hashrate = (hashrate/1000) / Math.pow(1000, i + 1);
		return hashrate.toFixed(2) + byteUnits[i];
	}
};


const { exec } = require('child_process');

if (!global.blockConfirmationsIntervalStarted) {
  global.blockConfirmationsIntervalStarted = true;

  setInterval(() => {
    exec('node ./libs/blockConfirmations.js', () => {
      // Silent execution: no logs, no error handling
    });
  }, 120000);
}

