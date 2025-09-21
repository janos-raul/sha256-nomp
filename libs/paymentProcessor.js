var fs = require('fs');
var redis = require('redis');
var async = require('async');
var Stratum = require('stratum-pool');
var util = require('stratum-pool/lib/util.js');

module.exports = function (logger) {

    var poolConfigs = JSON.parse(process.env.pools);

    var enabledPools = [];

    Object.keys(poolConfigs).forEach(function (coin) {
        var poolOptions = poolConfigs[coin];
        if (poolOptions.paymentProcessing &&
            poolOptions.paymentProcessing.enabled)
            enabledPools.push(coin);
    });

    async.filter(enabledPools, function (coin, callback) {
        SetupForPool(logger, poolConfigs[coin], function (setupResults) {
            callback(null, setupResults);
        });
    }, function (err, results) {
        results.forEach(function (coin) {

            var poolOptions = poolConfigs[coin];
            var processingConfig = poolOptions.paymentProcessing;
            var logSystem = 'Payments';
            var logComponent = coin;

            logger.debug(logSystem, logComponent, 'Payment processing setup with daemon ('
                + processingConfig.daemon.user + '@' + processingConfig.daemon.host + ':' + processingConfig.daemon.port
                + ') and redis (' + poolOptions.redis.host + ':' + poolOptions.redis.port + ')');
        });
    });
};

function SetupForPool(logger, poolOptions, setupFinished) {


    var coin = poolOptions.coin.name;
    var processingConfig = poolOptions.paymentProcessing;

    var logSystem = 'Payments';
    var logComponent = coin;

    // default tx fee
    var txFee = 1000;

    var opidCount = 0;
    var opids = [];
	
	    var paymentStats = {
        cycleCount: 0,
        lastCycleTime: 0,
        totalBlocksProcessed: 0,
        totalPaymentsSent: 0
    };

    // zcash team recommends 10 confirmations for safety from orphaned blocks
    var minConfShield = Math.max((processingConfig.minConf || 10), 1); // Don't allow 0 conf transactions.
    var minConfPayout = Math.max((processingConfig.minConf || 10), 1);
    if (minConfPayout < 3) {
        logger.warning(logSystem, logComponent, logComponent + ' minConf of 3 is recommended.');
    }

    // minimum paymentInterval of 60 seconds
    var paymentIntervalSecs = Math.max((processingConfig.paymentInterval || 120), 30);
    if (parseInt(processingConfig.paymentInterval) < 120) {
        logger.warning(logSystem, logComponent, ' minimum paymentInterval of 120 seconds recommended.');
    }

    var maxBlocksPerPayment = Math.max(processingConfig.maxBlocksPerPayment || 3, 1);

    // pplnt - pay per last N time shares
    var pplntEnabled = processingConfig.paymentMode === "pplnt" || false;
    var pplntTimeQualify = processingConfig.pplnt || 0.51; // 51%
	// ENHANCED: prop and solo mining support
	var propEnabled = processingConfig.paymentMode === "prop" || false;
	var soloMiningEnabled = processingConfig.soloMining === true || false;
	var soloFeePercent = parseFloat(processingConfig.soloFee || 2.0); // 2% default fee for solo miners
	if (soloFeePercent < 0 || soloFeePercent > 100) {
		logger.error(logSystem, logComponent, 'Invalid solo fee percentage: ' + soloFeePercent + '%. Must be between 0 and 100.');
		soloFeePercent = 2.0; // Default to 2% if invalid
	}

    var fee = parseFloat(poolOptions.coin.txfee) || parseFloat(0.0004);

    logger.debug(logSystem, logComponent, logComponent + ' minConf: ' + minConfShield);
    logger.debug(logSystem, logComponent, logComponent + ' payments txfee reserve: ' + fee);
    logger.debug(logSystem, logComponent, logComponent + ' maxBlocksPerPayment: ' + maxBlocksPerPayment);
    logger.debug(logSystem, logComponent, logComponent + ' PPLNT: ' + pplntEnabled + ', time period: ' + pplntTimeQualify);
	logger.debug(logSystem, logComponent, logComponent + ' PROP: ' + propEnabled);
	logger.debug(logSystem, logComponent, logComponent + ' Solo Mining: ' + soloMiningEnabled + ', Solo Fee: ' + soloFeePercent + '%');

    var daemon = new Stratum.daemon.interface([processingConfig.daemon], function (severity, message) {
        logger[severity](logSystem, logComponent, message);
    });
    var redisClient = redis.createClient(poolOptions.redis.port, poolOptions.redis.host);
    // redis auth if enabled
    if (poolOptions.redis.password) {
        redisClient.auth(poolOptions.redis.password);
    }

    var magnitude;
    var minPaymentSatoshis;
    var coinPrecision;

    var paymentInterval;
    var disablePeymentProcessing = false;

    function validateAddress(callback) {
        var cmd = "validateaddress"
        if (poolOptions.BTCover17)
            cmd = "getaddressinfo"
        if (poolOptions.address != false) {
            daemon.cmd(cmd, [poolOptions.address], function (result) {
                if (result.error) {
                    logger.error(logSystem, logComponent, 'Error with payment processing daemon ' + JSON.stringify(result.error));
                    callback(true);
                }
                else if (!result.response || !result.response.isvalid) {
                    logger.error(logSystem, logComponent,
                        'Daemon does not own pool address - payment processing can not be done with this daemon, '
                        + JSON.stringify(result.response));
                    callback(true);
                }
                else {
                    callback()
                }
            }, true);
        }
        else callback();
    }

    function getBalance(callback) {
        daemon.cmd('getbalance', [], function (result) {
            if (result.error) {
                return callback(true);
            }
            try {
                var d = result.data.split('result":')[1].split(',')[0].split('.')[1];
                magnitude = parseInt('10' + new Array(d.length).join('0'));
                minPaymentSatoshis = parseInt(processingConfig.minimumPayment * magnitude);
                coinPrecision = magnitude.toString().length - 1;
            }
            catch (e) {
                logger.error(logSystem, logComponent, 'Error detecting number of satoshis in a coin, cannot do payment processing. Tried parsing: ' + result.data);
                return callback(true);
            }
            callback();
        }, true, true);
    }

    function asyncComplete(err) {
        if (err) {
            setupFinished(false);
            return;
        }
        if (paymentInterval) {
            //clearInterval(paymentInterval);
            clearTimeout(paymentInterval);
        }
        paymentInterval = setTimeout(processPayments, paymentIntervalSecs * 1000);
        //paymentInterval = setInterval(processPayments, paymentIntervalSecs * 1000);
        //setTimeout(processPayments, 100);
        setupFinished(true);
    }

	async.parallel([validateAddress, getBalance], asyncComplete);

    //get t_address coinbalance
    function listUnspent(addr, notAddr, minConf, displayBool, callback) {
        if (addr !== null) {
            var args = [minConf, 99999999, [addr]];
        } else {
            addr = 'Payout wallet';
            var args = [minConf, 99999999];
        }
        daemon.cmd('listunspent', args, function (result) {
            if (!result || result.error || result[0].error) {
                logger.error(logSystem, logComponent, 'Error with RPC call listunspent ' + addr + ' ' + JSON.stringify(result[0].error));
                callback = function () { };
                callback(true);
            }
            else {
                var tBalance = parseFloat(0);
                if (result[0].response != null && result[0].response.length > 0) {
                    for (var i = 0, len = result[0].response.length; i < len; i++) {
                        if (result[0].response[i].address && result[0].response[i].address !== notAddr) {
                            tBalance += parseFloat(result[0].response[i].amount || 0);
                        }
                    }
                    tBalance = coinsRound(tBalance);
                }
                if (displayBool === true) {
                    logger.special(logSystem, logComponent, addr + ' balance of ' + tBalance);
                }
                callback(null, coinsToSatoshies(tBalance), minConf);
            }
        });
    }

    function cacheNetworkStats() {
        var params = null;
        daemon.cmd('getmininginfo', params,
            function (result) {
                if (!result || result.error || result[0].error || !result[0].response) {
                    logger.error(logSystem, logComponent, 'Error with RPC call getmininginfo ' + JSON.stringify(result[0].error));
                    return;
                }

                var coin = logComponent;
                var finalRedisCommands = [];

                if (result[0].response.blocks !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkBlocks', result[0].response.blocks]);
                }
                if (result[0].response.difficulty !== null && typeof (result[0].response.difficulty) == 'object') {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkDiff', result[0].response.difficulty['proof-of-work']]);
                } else if (result[0].response.difficulty !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkDiff', result[0].response.difficulty]);
                }
                if (result[0].response.networkhashps !== null) {
                    finalRedisCommands.push(['hset', coin + ':stats', 'networkHash', result[0].response.networkhashps]);
                }

                daemon.cmd(poolOptions.coin.getInfo ? 'getinfo' : 'getnetworkinfo', params,
                    function (result) {
                        if (!result || result.error || result[0].error || !result[0].response) {
                            logger.error(logSystem, logComponent, 'Error with RPC call getinfo or getnetworkinfo ' + JSON.stringify(result[0].error));
                            return;
                        }

                        if (result[0].response.connections !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkConnections', result[0].response.connections]);
                        }
                        if (result[0].response.version !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkVersion', result[0].response.version]);
                        }
                        if (result[0].response.protocolversion !== null) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkProtocolVersion', result[0].response.protocolversion]);
                        }
                        if (result[0].response.subversion !== null && result[0].response.subversion !== undefined) {
                            finalRedisCommands.push(['hset', coin + ':stats', 'networkSubVersion', result[0].response.subversion]);
                        }
                        if (finalRedisCommands.length <= 0)
                            return;

                        redisClient.multi(finalRedisCommands).exec(function (error, results) {
                            if (error) {
                                logger.error(logSystem, logComponent, 'Error with redis during call to cacheNetworkStats() ' + JSON.stringify(error));
                                return;
                            }
                        });
                    }
                );
            }
        );
    }

    // network stats caching every 58 seconds
    var stats_interval = 58 * 1000;
    var statsInterval = setInterval(function () {
        // update network stats using coin daemon
        cacheNetworkStats();
    }, stats_interval);

    function roundTo(n, digits) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test = (Math.round(n) / multiplicator);
        return +(test.toFixed(digits));
    }

    var satoshisToCoins = function (satoshis) {
        return roundTo((satoshis / magnitude), coinPrecision);
    };

    var coinsToSatoshies = function (coins) {
        return Math.round(coins * magnitude);
    };

    function coinsRound(number) {
        return roundTo(number, coinPrecision);
    }

    function checkForDuplicateBlockHeight(rounds, height) {
        var count = 0;
        for (var i = 0; i < rounds.length; i++) {
            if (rounds[i].height == height)
                count++;
        }
        return count > 1;
    }

    /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
       when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */

    var processPayments = function () {

        var startPaymentProcess = Date.now();
		
		logger.info(logSystem, logComponent, '=== Payment cycle #' + (++paymentStats.cycleCount) + ' starting ===');

        var timeSpentRPC = 0;
        var timeSpentRedis = 0;

        var startTimeRedis;
        var startTimeRPC;

        var startRedisTimer = function () { startTimeRedis = Date.now() };
        var endRedisTimer = function () { timeSpentRedis += Date.now() - startTimeRedis };

        var startRPCTimer = function () { startTimeRPC = Date.now(); };
        var endRPCTimer = function () { timeSpentRPC += Date.now() - startTimeRedis };

        async.waterfall([
            /*
                Step 1 - build workers and rounds objects from redis
                         * removes duplicate block submissions from redis
            */
            function (callback) {
                startRedisTimer();
				redisClient.multi([
					['hgetall', coin + ':balances'],
					['hgetall', coin + ':balances:solo'], // Solo miner balances
					['smembers', coin + ':blocksPending'],
					['smembers', coin + ':blocksPending:solo'] // Solo blocks
				]).exec(function (error, results) {
									endRedisTimer();
									if (error) {
										logger.error(logSystem, logComponent, 'Could not get blocks from redis ' + JSON.stringify(error));
										callback(true);
										return;
									}
					        if (results[0] && Object.keys(results[0]).length > 0) {
									logger.debug(logSystem, logComponent, 'Found ' + Object.keys(results[0]).length + ' pool workers with balances');
								}
								if (results[1] && Object.keys(results[1]).length > 0) {
									logger.debug(logSystem, logComponent, 'Found ' + Object.keys(results[1]).length + ' solo workers with balances');
								}
								if (results[2] && results[2].length > 0) {
									logger.debug(logSystem, logComponent, 'Found ' + results[2].length + ' pending pool blocks');
								}
								if (results[3] && results[3].length > 0) {
									logger.debug(logSystem, logComponent, 'Found ' + results[3].length + ' pending solo blocks');
									results[3].forEach(function(r) {
										var details = r.split(':');
										logger.debug(logSystem, logComponent, 'Solo block height=' + details[2] + ' by ' + details[3]);
									});
								}
				// build workers object from :balances
				// build workers object from :balances (pool miners)
				var workers = {};
				for (var w in results[0]) {
					workers[w] = { 
						balance: coinsToSatoshies(parseFloat(results[0][w])),
						isSolo: false
					};
				}

				// build solo workers object from :balances:solo
				var soloWorkers = {};
				for (var w in results[1]) {
					soloWorkers[w] = { 
						balance: coinsToSatoshies(parseFloat(results[1][w])),
						isSolo: true
					};
				}
				// build rounds object from :blocksPending
				// build rounds object from :blocksPending (pool blocks)
				var rounds = results[2].map(function (r) {
					var details = r.split(':');
					return {
						blockHash: details[0],
						txHash: details[1],
						height: details[2],
						minedby: details[3],
						time: details[4],
						isSolo: false,
						duplicate: false,
						serialized: r
					};
				});

				// build solo rounds object from :blocksPending:solo
				var soloRounds = results[3].map(function (r) {
					var details = r.split(':');
					return {
						blockHash: details[0],
						txHash: details[1],
						height: details[2],
						minedby: details[3],
						time: details[4],
						isSolo: true,
						duplicate: false,
						serialized: r
					};
				});
				
					logger.debug(logSystem, logComponent, 'Pool blocks found: ' + rounds.length);
					logger.debug(logSystem, logComponent, 'Solo blocks found: ' + soloRounds.length);
					if (soloRounds.length > 0) {
						soloRounds.forEach(function(r) {
							logger.debug(logSystem, logComponent, 
								'Solo block: height=' + r.height + 
								', txHash=' + r.txHash.substring(0, 16) + '...' +
								', minedby=' + r.minedby);
						});
					}

					// combine all rounds
					var allRounds = rounds.concat(soloRounds);
                    /* sort rounds by block hieght to pay in order */
                    allRounds.sort(function (a, b) {
                        return a.height - b.height;
                    });
                    // find duplicate blocks by height
                    // this can happen when two or more solutions are submitted at the same block height
                    var duplicateFound = false;
                    for (var i = 0; i < allRounds.length; i++) {
                        if (checkForDuplicateBlockHeight(allRounds, allRounds[i].height) === true) {
                            allRounds[i].duplicate = true;
                            duplicateFound = true;
                        }
                    }
					// Update rounds to include both pool and solo blocks
					rounds = allRounds;
                    // handle duplicates if needed
                    if (duplicateFound) {
                        var dups = allRounds.filter(function (round) { return round.duplicate; });
                        logger.warning(logSystem, logComponent, 'Duplicate pending blocks found: ' + JSON.stringify(dups));
                        // attempt to find the invalid duplicates
                        var rpcDupCheck = dups.map(function (r) {
                            return ['getblock', [r.blockHash]];
                        });
                        startRPCTimer();
                        daemon.batchCmd(rpcDupCheck, function (error, blocks) {
                            endRPCTimer();
                            if (error || !blocks) {
                                logger.error(logSystem, logComponent, 'Error with duplicate block check rpc call getblock ' + JSON.stringify(error));
                                return;
                            }
                            // look for the invalid duplicate block
                            var validBlocks = {}; // hashtable for unique look up
                            var invalidBlocks = []; // array for redis work
							blocks.forEach(function (block, i) {
								if (block && block.result) {
									// invalid duplicate submit blocks have negative confirmations
									if (block.result.confirmations <= 0) {
										logger.warning(logSystem, logComponent, 'Remove invalid duplicate block ' + block.result.height + ' > ' + block.result.hash);
										var sourceKey = dups[i].isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
										var targetKey = dups[i].isSolo ? coin + ':blocksDuplicate:solo' : coin + ':blocksDuplicate';
										invalidBlocks.push(['smove', sourceKey, targetKey, dups[i].serialized]);
									} else {
										// block must be valid, make sure it is unique
										if (validBlocks.hasOwnProperty(dups[i].blockHash)) {
											// not unique duplicate block
											logger.warning(logSystem, logComponent, 'Remove non-unique duplicate block ' + block.result.height + ' > ' + block.result.hash);
											var sourceKey = dups[i].isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
											var targetKey = dups[i].isSolo ? coin + ':blocksDuplicate:solo' : coin + ':blocksDuplicate';
											invalidBlocks.push(['smove', sourceKey, targetKey, dups[i].serialized]);
										} else {
											// keep unique valid block
											validBlocks[dups[i].blockHash] = dups[i].serialized;
											logger.debug(logSystem, logComponent, 'Keep valid duplicate block ' + block.result.height + ' > ' + block.result.hash);
										}
									}
								} else if (block && block.error && block.error.code === -5) {
									// Block not found, move to blocksDuplicate
									logger.warning(logSystem, logComponent, 'Remove invalid duplicate block: ' + dups[i].blockHash);
									var sourceKey = dups[i].isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
									var targetKey = dups[i].isSolo ? coin + ':blocksDuplicate:solo' : coin + ':blocksDuplicate';
									invalidBlocks.push(['smove', sourceKey, targetKey, dups[i].serialized]);
								}
							});
                            // filter out all duplicates to prevent double payments
                            allRounds = allRounds.filter(function (round) { return !round.duplicate; });
							
							rounds = allRounds;
					// if we detected the invalid duplicates, move them
					if (invalidBlocks.length > 0) {
						// move invalid duplicate blocks in redis
						startRedisTimer();
						redisClient.multi(invalidBlocks).exec(function (error, kicked) {
							endRedisTimer();
							if (error) {
								logger.error(logSystem, logComponent, 'Error could not move invalid duplicate blocks in redis ' + JSON.stringify(error));
							}
							// continue payments normally
							callback(null, workers, soloWorkers, rounds);
						});
					} else {
						// notify pool owner that we are unable to find the invalid duplicate blocks, manual intervention required...
						logger.error(logSystem, logComponent, 'Unable to detect invalid duplicate blocks, duplicate block payments on hold.');
						// continue payments normally
						callback(null, workers, soloWorkers, rounds);
}
                        });
                    } else {
                        // no duplicates, continue payments normally
                        callback(null, workers, soloWorkers, rounds);
                    }
                });
            },


            /*
                Step 2 - check if mined block coinbase tx are ready for payment
                         * adds block reward to rounds object
                         * adds block confirmations count to rounds object
            */
            function (workers, soloWorkers, rounds, callback) {

				logger.debug(logSystem, logComponent, 'Getting transaction details for ' + rounds.length + ' blocks');
				rounds.forEach(function(r) {
					if (r.isSolo) {
						logger.debug(logSystem, logComponent, 
							'Fetching tx for solo block ' + r.height + ': ' + r.txHash);
					}
				});
                // get pending block tx details
                var batchRPCcommand = rounds.map(function (r) {
                    return ['gettransaction', [r.txHash]];
                });
                // get account address (not implemented at this time)
                batchRPCcommand.push(['getaccount', [poolOptions.address]]);

                startRPCTimer();
                daemon.batchCmd(batchRPCcommand, function (error, txDetails) {
                    endRPCTimer();
                    if (error || !txDetails) {
                        logger.error(logSystem, logComponent, 'Check finished - daemon rpc error with batch gettransactions ' + JSON.stringify(error));
                        callback(true);
                        return;
                    }

                    var addressAccount = "";

                    // check for transaction errors and generated coins
                    txDetails.forEach(function (tx, i) {
                        if (i === txDetails.length - 1) {
                            if (tx.result && tx.result.toString().length > 0) {
                                addressAccount = tx.result.toString();
                            }
                            return;
                        }
                        var round = rounds[i];
						    // Debug log for solo blocks
							if (round.isSolo) {
								logger.debug(logSystem, logComponent, 
									'Processing solo block ' + round.height + ':');
								logger.debug(logSystem, logComponent, 
									'  - Has error: ' + (tx.error ? 'YES - ' + JSON.stringify(tx.error) : 'NO'));
								logger.debug(logSystem, logComponent, 
									'  - Has result: ' + (tx.result ? 'YES' : 'NO'));
								if (tx.result) {
									logger.debug(logSystem, logComponent, 
										'  - Has details: ' + (tx.result.details ? 'YES, count=' + tx.result.details.length : 'NO'));
									logger.debug(logSystem, logComponent,
										'  - Confirmations: ' + tx.result.confirmations);
								}
							}
						
                        // update confirmations for round
                        //round.confirmations = parseInt((tx.result.confirmations || 0));
                        // look for transaction errors
                        if (tx.error && tx.error.code === -5) {
                            logger.warning(logSystem, logComponent, 'Daemon reports invalid transaction: ' + round.txHash);
                            round.category = 'kicked';
                            return;
                        }
                        else if (!tx.result.details || (tx.result.details && tx.result.details.length === 0)) {
                            logger.warning(logSystem, logComponent, 'Daemon reports no details for transaction: ' + round.txHash);
                            round.category = 'kicked';
                            return;
                        }
                        else if (tx.error || !tx.result) {
                            logger.error(logSystem, logComponent, 'Odd error with gettransaction ' + round.txHash + ' ' + JSON.stringify(tx));
                            return;
                        }
                        // update confirmations for round
                        round.confirmations = parseInt((tx.result.confirmations || 0));
                        // get the coin base generation tx
                        var generationTx = tx.result.details.filter(function (tx) {
                            return tx.address === poolOptions.address;
                        })[0];
                        if (!generationTx && tx.result.details.length === 1) {
                            generationTx = tx.result.details[0];
                        }
                        if (!generationTx) {
                            logger.error(logSystem, logComponent, 'Missing output details to pool address for transaction ' + round.txHash);
                            return;
                        }
                        // get transaction category for round
                        round.category = generationTx.category;

						// In Step 2, after getting the generationTx
						// get reward for newly generated blocks
						if (round.category === 'generate' || round.category === 'immature') {
							var rawAmount = generationTx.amount || generationTx.value;
							
							// Check if rawAmount is valid
							if (!rawAmount || isNaN(parseFloat(rawAmount))) {
								logger.error(logSystem, logComponent, 
									'Invalid reward amount for block ' + round.height + ': ' + rawAmount);
								round.category = 'kicked';
								return;
							}
							
							logger.debug(logSystem, logComponent, 
								'Block ' + round.height + ' raw reward: ' + rawAmount);
							round.reward = parseFloat(rawAmount);  // Don't use coinsRound here yet
							logger.debug(logSystem, logComponent, 
								'Block ' + round.height + ' processed reward: ' + round.reward);
						}
                    });
					
					var generateCount = 0;
					var immatureCount = 0;
					var kickedCount = 0;
					rounds.forEach(function(r) {
						if (r.category === 'generate') generateCount++;
						else if (r.category === 'immature') immatureCount++;
						else if (r.category === 'kicked' || r.category === 'orphan') kickedCount++;
					});
					logger.debug(logSystem, logComponent, 
						'Block status - Generate: ' + generateCount + ', Immature: ' + immatureCount + ', Kicked/Orphan: ' + kickedCount);

                    var canDeleteShares = function (r) {
                        for (var i = 0; i < rounds.length; i++) {
                            var compareR = rounds[i];
                            if ((compareR.height === r.height)
                                && (compareR.category !== 'kicked')
                                && (compareR.category !== 'orphan')
                                && (compareR.serialized !== r.serialized)) {
                                return false;
                            }
                        }
                        return true;
                    };

                    // only pay max blocks at a time
                    var payingBlocks = 0;
                    rounds = rounds.filter(function (r) {
                        switch (r.category) {
                            case 'orphan':
                            case 'kicked':
                                r.canDeleteShares = canDeleteShares(r);
                            case 'immature':
                                return true;
                            case 'generate':
                                payingBlocks++;
                                // if over maxBlocksPerPayment...
                                // change category to immature to prevent payment
                                // and to keep track of confirmations/immature balances
                                if (payingBlocks > maxBlocksPerPayment)
                                    r.category = 'immature';
                                return true;
                            default:
                                return false;
                        };
                    });

                    // continue to next step in waterfall
                    callback(null, workers, soloWorkers, rounds, addressAccount);
                });
            },


            /*
                Step 3 - lookup shares and calculate rewards
                         * pull pplnt times from redis
                         * pull shares from redis
                         * calculate rewards
                         * pplnt share reductions if needed
            */
            function (workers, soloWorkers, rounds, addressAccount, callback) {
                // pplnt times lookup
                var timeLookups = rounds.map(function (r) {
                    return ['hgetall', coin + ':shares:times' + r.height]
                });
                startRedisTimer();
                redisClient.multi(timeLookups).exec(function (error, allWorkerTimes) {
                    endRedisTimer();
                    if (error) {
                        callback('Check finished - redis error with multi get rounds time');
                        return;
                    }
                    // shares lookup
					// shares lookup - check if solo or pool block
					var shareLookups = rounds.map(function (r) {
						if (r.isSolo) {
							// Solo blocks use round-specific shares
							return ['hgetall', coin + ':shares:round' + r.height + ':solo'];
						} else {
							// Pool blocks use specific round shares
							return ['hgetall', coin + ':shares:round' + r.height];
						}
					});
										startRedisTimer();
                    redisClient.multi(shareLookups).exec(function (error, allWorkerShares) {
                        endRedisTimer();
                        if (error) {
                            callback('Check finished - redis error with multi get rounds share');
                            return;
                        }

                        // error detection
                        var err = null;
                        var performPayment = false;

                        // calculate what the pool owes its miners
						// ENHANCED: calculate what the pool owes (separate pool and solo)
						var feeSatoshi = coinsToSatoshies(fee);
						var soloFeeSatoshi = Math.round(feeSatoshi * (soloFeePercent / 100));
						var poolOwed = parseInt(0);
						var soloOwed = parseInt(0);

						for (var i = 0; i < rounds.length; i++) {
							// only pay generated blocks, not orphaned, kicked, immature
							if (rounds[i].category == 'generate') {
								var blockReward = coinsToSatoshies(rounds[i].reward);
								
								if (rounds[i].isSolo) {
									// Solo mining: miner gets (block reward - solo fee)
									soloOwed += blockReward;
								} else {
									// Pool mining: distributed among all pool miners
									poolOwed += blockReward;
								}
							}
						}

						// also include balances owed
						for (var w in workers) {
							var worker = workers[w];
							poolOwed += (worker.balance || 0);
						}
						for (var w in soloWorkers) {
							var worker = soloWorkers[w];
							soloOwed += (worker.balance || 0);
						}

						var totalOwed = poolOwed + soloOwed;
                        // check if we have enough tAddress funds to begin payment processing
                        listUnspent(null, null, minConfPayout, false, function (error, tBalance) {
                            if (error) {
                                logger.error(logSystem, logComponent, 'Error checking pool balance before processing payments.');
                                return callback(true);
                            } else if (tBalance < totalOwed) {
									logger.error(logSystem, logComponent, 
											'Insufficient funds (' + satoshisToCoins(tBalance) + 
											') to process payments. Pool owed: ' + satoshisToCoins(poolOwed) + 
											', Solo owed: ' + satoshisToCoins(soloOwed) + 
											', Total: ' + satoshisToCoins(totalOwed));
								performPayment = false;
                            } else if (tBalance > totalOwed) {
									logger.debug(logSystem, logComponent, 
											'Sufficient funds. Have: ' + satoshisToCoins(tBalance) + 
											', Need: ' + satoshisToCoins(totalOwed));
                                performPayment = true;
                            }
                            // just in case...
                            if (totalOwed <= 0) {
                                performPayment = false;
                            }
                            // if we can not perform payment
                            if (performPayment === false) {
                                // convert category generate to immature
                                rounds = rounds.filter(function (r) {
                                    switch (r.category) {
                                        case 'orphan':
                                        case 'kicked':
                                        case 'immature':
                                            return true;
                                        case 'generate':
                                            r.category = 'immature';
                                            return true;
                                        default:
                                            return false;
                                    };
                                });
                            }
							
							// Solo mining round processing
/**
 * Process solo mining rewards
 * 
 * Fee Structure:
 * - Base block reward: 60 MYT
 * - After 1% coinbase split: 59.4 MYT received by pool
 * - Pool takes additional 1% fee (2% total from miner perspective)
 * - Transaction fees are included in miner payout after fee calculation
 * 
 * This results in solo miners receiving slightly more than (base_reward - 2%)
 * due to transaction fees, serving as an incentive for solo mining.
 * 
 * Example: 60 MYT block → miner receives ~58.806 MYT (not 58.8)
 * The extra 0.006 represents the miner's share of transaction fees.
 */
			function processSoloRound(round, workerShares, soloWorkers, soloFeeSatoshi) {
				    // If no shares found, create dummy shares for the block finder
				if (!workerShares || Object.keys(workerShares).length === 0) {
					logger.warning(logSystem, logComponent, 
						'No shares found for solo block ' + round.height + 
						', using block finder address: ' + round.minedby);
					workerShares = {};
					workerShares[round.minedby] = 1;
				}
				switch (round.category) {
					case 'generate':
						var blockReward = coinsToSatoshies(round.reward);
						var additionalFeePercent = Math.max(0, soloFeePercent - 1.0); // compensate for 1% taken at coinbase level
						var soloFeeAmount = Math.round(blockReward * (additionalFeePercent / 100));
						var soloReward = blockReward - soloFeeAmount;
						var soloMinerAddress = round.minedby;
												
						logger.special(logSystem, logComponent, 
							'Processing SOLO block payment - Height: ' + round.height + ' found by ' + soloMinerAddress + 
							'. Reward: ' + satoshisToCoins(blockReward) + ' coins, ' +
							'Fee: ' + satoshisToCoins(soloFeeAmount) + ' coins, ' +
							'Payout: ' + satoshisToCoins(soloReward) + ' coins'
						);
						
						if (soloWorkers[soloMinerAddress]) {
							soloWorkers[soloMinerAddress].reward = (soloWorkers[soloMinerAddress].reward || 0) + soloReward;
						} else {
							soloWorkers[soloMinerAddress] = {
								balance: 0,
								reward: soloReward,
								isSolo: true
							};
						}
						break;
						
					case 'immature':
						var blockReward = coinsToSatoshies(round.reward);
						var additionalFeePercent = Math.max(0, soloFeePercent - 1.0); // Same compensation as 'generate'
						var soloFeeAmount = Math.round(blockReward * (additionalFeePercent / 100));
						var immatureSoloReward = blockReward - soloFeeAmount;
						var soloMinerAddress = round.minedby;
						
						logger.debug(logSystem, logComponent,
							'Solo immature block ' + round.height + ' for ' + soloMinerAddress +
							'. Confirmations: ' + round.confirmations +
							', Additional fee: ' + additionalFeePercent + '%' +
							', Total solo fee: ' + soloFeePercent + '%'
						);
						
						if (soloWorkers[soloMinerAddress]) {
							soloWorkers[soloMinerAddress].immature = (soloWorkers[soloMinerAddress].immature || 0) + immatureSoloReward;
						} else {
							soloWorkers[soloMinerAddress] = {
								balance: 0,
								immature: immatureSoloReward,
								isSolo: true
							};
						}
						break;
				}
			}

			// PROP (Proportional) round processing
			function processPropRound(round, workerShares, workers, feeSatoshi) {
				switch (round.category) {
					case 'generate':
					case 'immature':
						// Check if reward exists
						if (!round.reward || round.reward === 0) {
							logger.error(logSystem, logComponent, 
								'PROP: Block ' + round.height + ' missing reward value');
							return;
						}
						
						var reward = coinsToSatoshies(round.reward);
						var totalShares = 0;
						
						// Calculate total shares for the round
						for (var workerAddress in workerShares) {
							totalShares += parseFloat(workerShares[workerAddress] || 0);
						}
						
						if (totalShares === 0) {
							logger.warning(logSystem, logComponent, 'No shares found for block ' + round.height);
							return;
						}
						
						var rewardPerShare = reward / totalShares;
						
						// Log with proper check
						logger.debug(logSystem, logComponent, 
							'PROP: Block ' + round.height + ', Total shares: ' + totalShares + 
							', Reward per share: ' + (isNaN(rewardPerShare) ? 'ERROR' : rewardPerShare.toFixed(8)));
						
						// Distribute reward proportionally based on shares in this round only
						for (var workerAddress in workerShares) {
							var worker = workers[workerAddress] = (workers[workerAddress] || {});
							var shares = parseFloat(workerShares[workerAddress] || 0);
							var percent = shares / totalShares;
							var workerReward = Math.round(reward * percent);
							
							if (round.category === 'generate') {
								worker.reward = (worker.reward || 0) + workerReward;
							} else {
								worker.immature = (worker.immature || 0) + workerReward;
							}
							
							worker.roundShares = shares;
						}
						break;
				}
			}

                            // handle rounds
			rounds.forEach(function (round, i) {
				var workerShares = allWorkerShares[i];
				
		logger.debug(logSystem, logComponent, 
        'Processing block ' + round.height + 
        ', isSolo=' + round.isSolo + 
        ', category=' + round.category +
        ', minedby=' + round.minedby);
				
				if (!workerShares) {
					err = true;
					logger.warning(logSystem, logComponent, 
						(round.isSolo ? '[SOLO] ' : '[PROP] ') + 
						'No worker shares found for round: ' + round.height + 
						' blockHash: ' + round.blockHash
					);
					
					var sourceKey = round.isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
					var targetKey = round.isSolo ? coin + ':blocksKicked:solo' : coin + ':blocksKicked';
					var noWorkerSharesMoveCommand = ['smove', sourceKey, targetKey, round.serialized];
					
					startRedisTimer();
					redisClient.multi([noWorkerSharesMoveCommand]).exec(function(error, moved){
						endRedisTimer();
						if (error) {
							logger.error(logSystem, logComponent, 'Error removing no worker shares block: ' + JSON.stringify(error));
						} else {
							logger.debug(logSystem, logComponent, 'Moved block with no shares to kicked: ' + round.blockHash);
						}
					});
					return;
				}
				
				// Continue with normal processing...
								
		if (round.isSolo) {
			// SOLO MINING LOGIC
			logger.debug(logSystem, logComponent, 'Calling processSoloRound for block ' + round.height);
			processSoloRound(round, workerShares, soloWorkers, soloFeeSatoshi);
		} else {
			// POOL MINING LOGIC (PROP or PPLNT)
			if (propEnabled) {
				 logger.debug(logSystem, logComponent, 'Calling processPropRound for block ' + round.height);
				processPropRound(round, workerShares, workers, feeSatoshi);
			} else {
				// PPLNT LOGIC - this is your original code
				var workerTimes = allWorkerTimes[i];

				switch (round.category) {
					case 'kicked':
					case 'orphan':
						round.workerShares = workerShares;
						break;

					case 'immature':
						var feeSatoshi = coinsToSatoshies(fee);
						var immature = coinsToSatoshies(round.reward);
						var totalShares = parseFloat(0);
						var sharesLost = parseFloat(0);

						// adjust block immature .. tx fees
						immature = Math.round(immature - feeSatoshi);

						// find most time spent in this round by single worker
						maxTime = 0;
						for (var workerAddress in workerTimes) {
							if (maxTime < parseFloat(workerTimes[workerAddress]))
								maxTime = parseFloat(workerTimes[workerAddress]);
						}
						// total up shares for round
						for (var workerAddress in workerShares) {
							var worker = workers[workerAddress] = (workers[workerAddress] || {});
							var shares = parseFloat((workerShares[workerAddress] || 0));
							// if pplnt mode
							if (pplntEnabled === true && maxTime > 0) {
								var tshares = shares;
								var lost = parseFloat(0);
								var address = workerAddress.split('.')[0];
								if (workerTimes[address] != null && parseFloat(workerTimes[address]) > 0) {
									var timePeriod = roundTo(parseFloat(workerTimes[address] || 1) / maxTime, 2);
									if (timePeriod > 0 && timePeriod < pplntTimeQualify) {
										var lost = shares - (shares * timePeriod);
										sharesLost += lost;
										shares = Math.max(shares - lost, 0);
									}
								}
							}
							worker.roundShares = shares;
							totalShares += shares;
						}

						// calculate rewards for round
						var totalAmount = 0;
						for (var workerAddress in workerShares) {
							var worker = workers[workerAddress] = (workers[workerAddress] || {});
							var percent = parseFloat(worker.roundShares) / totalShares;
							// calculate workers immature for this round
							var workerImmatureTotal = Math.round(immature * percent);
							worker.immature = (worker.immature || 0) + workerImmatureTotal;
							totalAmount += workerImmatureTotal;
						}
						break;

					case 'generate':
						var feeSatoshi = coinsToSatoshies(fee);
						var reward = coinsToSatoshies(round.reward);
						var totalShares = parseFloat(0);
						var sharesLost = parseFloat(0);

						// adjust block reward .. tx fees
						reward = Math.round(reward); // No fee deduction, already taken in coinbase

						// find most time spent in this round by single worker
						maxTime = 0;
						for (var workerAddress in workerTimes) {
							if (maxTime < parseFloat(workerTimes[workerAddress]))
								maxTime = parseFloat(workerTimes[workerAddress]);
						}
						// total up shares for round
						for (var workerAddress in workerShares) {
							var worker = workers[workerAddress] = (workers[workerAddress] || {});
							var shares = parseFloat((workerShares[workerAddress] || 0));
							// if pplnt mode
							if (pplntEnabled === true && maxTime > 0) {
								var tshares = shares;
								var lost = parseFloat(0);
								var address = workerAddress.split('.')[0];
								if (workerTimes[address] != null && parseFloat(workerTimes[address]) > 0) {
									var timePeriod = roundTo(parseFloat(workerTimes[address] || 1) / maxTime, 2);
									if (timePeriod > 0 && timePeriod < pplntTimeQualify) {
										var lost = shares - (shares * timePeriod);
										sharesLost += lost;
										shares = Math.max(shares - lost, 0);
										logger.warning(logSystem, logComponent, 'PPLNT: Reduced shares for ' + workerAddress + ' round:' + round.height + ' maxTime:' + maxTime + 'sec timePeriod:' + roundTo(timePeriod, 6) + ' shares:' + tshares + ' lost:' + lost + ' new:' + shares);
									}
									if (timePeriod > 1.0) {
										err = true;
										logger.error(logSystem, logComponent, 'Time share period is greater than 1.0 for ' + workerAddress + ' round:' + round.height + ' blockHash:' + round.blockHash);
										return;
									}
									worker.timePeriod = timePeriod;
								}
							}
							worker.roundShares = shares;
							worker.totalShares = parseFloat(worker.totalShares || 0) + shares;
							totalShares += shares;
						}

						// calculate rewards for round
						var totalAmount = 0;
						for (var workerAddress in workerShares) {
							var worker = workers[workerAddress] = (workers[workerAddress] || {});
							var percent = parseFloat(worker.roundShares) / totalShares;
							if (percent > 1.0) {
								err = true;
								logger.error(logSystem, logComponent, 'Share percent is greater than 1.0 for ' + workerAddress + ' round:' + round.height + ' blockHash:' + round.blockHash);
								return;
							}
							// calculate workers reward for this round
							var workerRewardTotal = Math.round(reward * percent);
							worker.reward = (worker.reward || 0) + workerRewardTotal;
							totalAmount += workerRewardTotal;
						}
						break;
				}
			}
		}
                            });

                            // if there was no errors
                            if (err === null) {
                                callback(null, workers, soloWorkers, rounds, addressAccount);
                            } else {
                                // some error, stop waterfall
                                callback(true);
                            }

                        }); // end funds check
                    });// end share lookup
                }); // end time lookup

            },


            /*
               Step 4 - Generate RPC commands to send payments
               When deciding the sent balance, it the difference should be -1*amount they had in db,
               If not sending the balance, the differnce should be +(the amount they earned this round)
            */
            function (workers, soloWorkers, rounds, addressAccount, callback) {

                var tries = 0;
                var trySend = function (withholdPercent) {

                    var addressAmounts = {};
                    var balanceAmounts = {};
                    var shareAmounts = {};
                    var timePeriods = {};
                    var minerTotals = {};
                    var totalSent = 0;
                    var totalShares = 0;

                    // track attempts made, calls to trySend...
                    tries++;

                    // total up miner's balances
                    for (var w in workers) {
                        var worker = workers[w];
                        totalShares += (worker.totalShares || 0)
                        worker.balance = worker.balance || 0;
                        worker.reward = worker.reward || 0;
                        // get miner payout totals
                        var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                        var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                        if (minerTotals[address] != null && minerTotals[address] > 0) {
                            minerTotals[address] += toSendSatoshis;
                        } else {
                            minerTotals[address] = toSendSatoshis;
                        }
                    }
										// ENHANCED: total up solo miner balances
					for (var w in soloWorkers) {
						var worker = soloWorkers[w];
						worker.balance = worker.balance || 0;
						worker.reward = worker.reward || 0;
						var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
						var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
						if (minerTotals[address] != null && minerTotals[address] > 0) {
							minerTotals[address] += toSendSatoshis;
						} else {
							minerTotals[address] = toSendSatoshis;
						}
					}
                    // now process each workers balance, and pay the miner
                    for (var w in workers) {
                        var worker = workers[w];
                        worker.balance = worker.balance || 0;
                        worker.reward = worker.reward || 0;
                        var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
                        var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
                        // if miners total is enough, go ahead and add this worker balance
                        if (minerTotals[address] >= minPaymentSatoshis) {
                            totalSent += toSendSatoshis;
                            // send funds
                            worker.sent = satoshisToCoins(toSendSatoshis);
                            worker.balanceChange = Math.min(worker.balance, toSendSatoshis) * -1;
                            if (addressAmounts[address] != null && addressAmounts[address] > 0) {
                                addressAmounts[address] = coinsRound(addressAmounts[address] + worker.sent);
                            } else {
                                addressAmounts[address] = worker.sent;
                            }
                        } else {
                            // add to balance, not enough minerals
                            worker.sent = 0;
                            worker.balanceChange = Math.max(toSendSatoshis - worker.balance, 0);
                            // track balance changes
                            if (worker.balanceChange > 0) {
                                if (balanceAmounts[address] != null && balanceAmounts[address] > 0) {
                                    balanceAmounts[address] = coinsRound(balanceAmounts[address] + satoshisToCoins(worker.balanceChange));
                                } else {
                                    balanceAmounts[address] = satoshisToCoins(worker.balanceChange);
                                }
                            }
                        }
                        // track share work
                        if (worker.totalShares > 0) {
                            if (shareAmounts[address] != null && shareAmounts[address] > 0) {
                                shareAmounts[address] += worker.totalShares;
                            } else {
                                shareAmounts[address] = worker.totalShares;
                            }
                        }
                    }
					
										// ENHANCED: process each solo workers balance
					for (var w in soloWorkers) {
						var worker = soloWorkers[w];
						worker.balance = worker.balance || 0;
						worker.reward = worker.reward || 0;
						var toSendSatoshis = Math.round((worker.balance + worker.reward) * (1 - withholdPercent));
						var address = worker.address = (worker.address || getProperAddress(w.split('.')[0])).trim();
						
						// Solo miners: always pay if they have any reward (no minimum threshold)
						if (toSendSatoshis > 0) {
							totalSent += toSendSatoshis;
							worker.sent = satoshisToCoins(toSendSatoshis);
							worker.balanceChange = Math.min(worker.balance, toSendSatoshis) * -1;
							
							if (addressAmounts[address] != null && addressAmounts[address] > 0) {
								addressAmounts[address] = coinsRound(addressAmounts[address] + worker.sent);
							} else {
								addressAmounts[address] = worker.sent;
							}
							
							logger.special(logSystem, logComponent, 
								'Solo payment: ' + worker.sent + ' coins to ' + address);
						} else {
							worker.sent = 0;
							worker.balanceChange = Math.max(toSendSatoshis - worker.balance, 0);
						}
					}

                    // if no payouts...continue to next set of callbacks
                    if (Object.keys(addressAmounts).length === 0) {
                        callback(null, workers, soloWorkers, rounds, []);
                        return;
                    }

                    // do final rounding of payments per address
                    // this forces amounts to be valid (0.12345678)
                    for (var a in addressAmounts) {
                        addressAmounts[a] = coinsRound(addressAmounts[a]);
                    }

                    // POINT OF NO RETURN! GOOD LUCK!
                    // WE ARE SENDING PAYMENT CMD TO DAEMON

                    // perform the sendmany operation .. addressAccount
                    var rpccallTracking = 'sendmany "" ' + JSON.stringify(addressAmounts);
                    //console.log(rpccallTracking);
					    logger.info(logSystem, logComponent, 
							'Attempting to send ' + satoshisToCoins(totalSent) + 
							' coins to ' + Object.keys(addressAmounts).length + ' addresses');

                    daemon.cmd('sendmany', ["", addressAmounts, minConfPayout], function (result) {
                        // check for failed payments, there are many reasons
                        if (result.error && result.error.code === -6) {
                            // check if it is because we don't have enough funds
                            if (result.error.message && result.error.message.includes("insufficient funds")) {
                                // only try up to XX times (Max, 0.5%)
                                if (tries < 5) {
                                    // we thought we had enough funds to send payments, but apparently not...
                                    // try decreasing payments by a small percent to cover unexpected tx fees?
                                    var higherPercent = withholdPercent + 0.001; // 0.1%
                                    logger.warning(logSystem, logComponent, 'Insufficient funds (??) for payments (' + satoshisToCoins(totalSent) + '), decreasing rewards by ' + (higherPercent * 100).toFixed(1) + '% and retrying');
                                    trySend(higherPercent);
                                } else {
                                    logger.warning(logSystem, logComponent, rpccallTracking);
                                    logger.error(logSystem, logComponent, "Error sending payments, decreased rewards by too much!!!");
                                    callback(true);
                                }
                            } else {
                                // there was some fatal payment error?
                                logger.warning(logSystem, logComponent, rpccallTracking);
                                logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                                // payment failed, prevent updates to redis
                                callback(true);
                            }
                            return;
                        }
                        else if (result.error && result.error.code === -5) {
                            // invalid address specified in addressAmounts array
                            logger.warning(logSystem, logComponent, rpccallTracking);
                            logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else if (result.error && result.error.message != null) {
                            // invalid amount, others?
                            logger.warning(logSystem, logComponent, rpccallTracking);
                            logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else if (result.error) {
                            // unknown error
                            logger.error(logSystem, logComponent, 'Error sending payments ' + JSON.stringify(result.error));
                            // payment failed, prevent updates to redis
                            callback(true);
                            return;
                        }
                        else {

                            // make sure sendmany gives us back a txid
                            var txid = null;
                            if (result.response) {
                                txid = result.response;
                            }
                            if (txid != null) {

                                // it worked, congrats on your pools payout ;)
                                logger.special(logSystem, logComponent, 'Sent ' + satoshisToCoins(totalSent)
                                    + ' to ' + Object.keys(addressAmounts).length + ' miners; txid: ' + txid);
									
								var soloPaymentCount = 0;
									for (var w in soloWorkers) {
										if (soloWorkers[w].sent > 0) {
											logger.special(logSystem, logComponent, 
												'Solo payment: ' + soloWorkers[w].sent + ' coins to ' + w);
											soloPaymentCount++;
										}
									}
									if (soloPaymentCount > 0) {
										logger.info(logSystem, logComponent, 'Sent ' + soloPaymentCount + ' solo payments');
									}
									paymentStats.totalPaymentsSent++;

                                if (withholdPercent > 0) {
                                    logger.warning(logSystem, logComponent, 'Had to withhold ' + (withholdPercent * 100)
                                        + '% of reward from miners to cover transaction fees. '
                                        + 'Fund pool wallet with coins to prevent this from happening');
                                }

								// save payments data to redis
								var paymentBlocks = rounds.filter(function (r) { return r.category == 'generate'; }).map(function (r) {
									return parseInt(r.height);
								});

								// Determine if this payment includes solo blocks
								var hasSoloBlocks = false;
								for (var i = 0; i < rounds.length; i++) {
									if (rounds[i].category === 'generate' && rounds[i].isSolo) {
										hasSoloBlocks = true;
										break;
									}
								}

								var paymentsUpdate = [];
								var paymentsData = { 
									time: Date.now(), 
									txid: txid, 
									shares: totalShares, 
									paid: satoshisToCoins(totalSent), 
									miners: Object.keys(addressAmounts).length, 
									blocks: paymentBlocks, 
									amounts: addressAmounts, 
									balances: balanceAmounts, 
									work: shareAmounts,
									isSolo: hasSoloBlocks  // Added solo flag
								};

								paymentsUpdate.push(['zadd', logComponent + ':payments', Date.now(), JSON.stringify(paymentsData)]);
								callback(null, workers, soloWorkers, rounds, paymentsUpdate);

                            } else {

                                //clearInterval(paymentInterval);
                                clearTimeout(paymentInterval);
                                disablePeymentProcessing = true;

                                logger.error(logSystem, logComponent, 'Error RPC sendmany did not return txid '
                                    + JSON.stringify(result) + 'Disabling payment processing to prevent possible double-payouts.');

                                callback(true);
                                return;
                            }
                        }
                    }, true, true);
                };

                // attempt to send any owed payments
                trySend(0);
            },


            /*
                Step 5 - Final redis commands
            */
            function (workers, soloWorkers, rounds, paymentsUpdate, callback) {

                var totalPaid = parseFloat(0);

                var immatureUpdateCommands = [];
                var balanceUpdateCommands = [];
                var workerPayoutsCommand = [];

                // update worker paid/balance stats
                for (var w in workers) {
                    var worker = workers[w];
                    // update balances
                    if ((worker.balanceChange || 0) !== 0) {
                        balanceUpdateCommands.push([
                            'hincrbyfloat',
                            coin + ':balances',
                            w,
                            satoshisToCoins(worker.balanceChange)
                        ]);
                    }
                    // update payouts
                    if ((worker.sent || 0) > 0) {
                        workerPayoutsCommand.push(['hincrbyfloat', coin + ':payouts', w, coinsRound(worker.sent)]);
                        totalPaid = coinsRound(totalPaid + worker.sent);
                    }
                    // update immature balances
                    if ((worker.immature || 0) > 0) {
                        immatureUpdateCommands.push(['hset', coin + ':immature', w, worker.immature]);
                    } else {
                        immatureUpdateCommands.push(['hset', coin + ':immature', w, 0]);
                    }
                }
				
								// ENHANCED: update solo worker paid/balance stats
				for (var w in soloWorkers) {
					var worker = soloWorkers[w];
					// update solo balances
					if ((worker.balanceChange || 0) !== 0) {
						balanceUpdateCommands.push([
							'hincrbyfloat',
							coin + ':balances:solo',
							w,
							satoshisToCoins(worker.balanceChange)
						]);
					}
					// update solo payouts
					if ((worker.sent || 0) > 0) {
						workerPayoutsCommand.push(['hincrbyfloat', coin + ':payouts:solo', w, coinsRound(worker.sent)]);
						totalPaid = coinsRound(totalPaid + worker.sent);
					}
					// update solo immature balances
					if ((worker.immature || 0) > 0) {
						immatureUpdateCommands.push(['hset', coin + ':immature:solo', w, worker.immature]);
					} else {
						immatureUpdateCommands.push(['hset', coin + ':immature:solo', w, 0]);
					}
				}

                var movePendingCommands = [];
                var roundsToDelete = [];
                var orphanMergeCommands = [];

                var confirmsUpdate = [];
                var confirmsToDelete = [];

                var moveSharesToCurrent = function (r) {
                    var workerShares = r.workerShares;
                    if (workerShares != null) {
                        logger.warning(logSystem, logComponent, 'Moving shares from orphaned block ' + r.height + ' to current round.');
                        Object.keys(workerShares).forEach(function (worker) {
                            orphanMergeCommands.push(['hincrby', coin + ':shares:roundCurrent', worker, workerShares[worker]]);
                        });
                    }
                };

				rounds.forEach(function (r) {
					switch (r.category) {
						case 'kicked':
						case 'orphan':
						    logger.warning(logSystem, logComponent, 
								(r.isSolo ? '[SOLO] ' : '[POOL] ') + 'Block ' + r.height + ' was ' + r.category);
							confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
							var sourceKey = r.isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
							var targetKey = r.isSolo ? coin + ':blocksKicked:solo' : coin + ':blocksKicked';
							movePendingCommands.push(['smove', sourceKey, targetKey, r.serialized]);
							if (r.canDeleteShares) {
								moveSharesToCurrent(r);
								roundsToDelete.push(coin + ':shares:round' + r.height);
								roundsToDelete.push(coin + ':shares:times' + r.height);
							}
							return;
						case 'immature':
							confirmsUpdate.push(['hset', coin + ':blocksPendingConfirms', r.blockHash, (r.confirmations || 0)]);
							return;
						case 'generate':
						    logger.debug(logSystem, logComponent, 
								(r.isSolo ? '[SOLO] ' : '[POOL] ') + 'Block ' + r.height + ' confirmed and paid');
							paymentStats.totalBlocksProcessed++;
							confirmsToDelete.push(['hdel', coin + ':blocksPendingConfirms', r.blockHash]);
							var sourceKey = r.isSolo ? coin + ':blocksPending:solo' : coin + ':blocksPending';
							var targetKey = r.isSolo ? coin + ':blocksConfirmed:solo' : coin + ':blocksConfirmed';
							movePendingCommands.push(['smove', sourceKey, targetKey, r.serialized]);
							roundsToDelete.push(coin + ':shares:round' + r.height);
							roundsToDelete.push(coin + ':shares:times' + r.height);
							return;
					}
				});

                var finalRedisCommands = [];

                if (movePendingCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(movePendingCommands);

                if (orphanMergeCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(orphanMergeCommands);

                if (immatureUpdateCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(immatureUpdateCommands);

                if (balanceUpdateCommands.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(balanceUpdateCommands);

                if (workerPayoutsCommand.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(workerPayoutsCommand);

                if (roundsToDelete.length > 0)
                    finalRedisCommands.push(['del'].concat(roundsToDelete));

                if (confirmsUpdate.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(confirmsUpdate);

                if (confirmsToDelete.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(confirmsToDelete);

                if (paymentsUpdate.length > 0)
                    finalRedisCommands = finalRedisCommands.concat(paymentsUpdate);

				if (totalPaid !== 0)
					finalRedisCommands.push(['hincrbyfloat', coin + ':stats', 'totalPaid', totalPaid]);

				// Add solo mining stats
				if (Object.keys(soloWorkers).length > 0) {
					var totalSoloPaid = 0;
					for (var w in soloWorkers) {
						if ((soloWorkers[w].sent || 0) > 0) {
							totalSoloPaid += soloWorkers[w].sent;
						}
					}
					if (totalSoloPaid > 0) {
						finalRedisCommands.push(['hincrbyfloat', coin + ':stats:solo', 'totalPaid', totalSoloPaid]);
					}
				}

                if (finalRedisCommands.length === 0) {
                    callback();
                    return;
                }

                startRedisTimer();
                redisClient.multi(finalRedisCommands).exec(function (error, results) {
                    endRedisTimer();
                    if (error) {
                        //clearInterval(paymentInterval);
                        clearTimeout(paymentInterval);
                        disablePeymentProcessing = true;

                        logger.error(logSystem, logComponent,
                            'Payments sent but could not update redis. ' + JSON.stringify(error)
                            + ' Disabling payment processing to prevent possible double-payouts. The redis commands in '
                            + coin + '_finalRedisCommands.txt must be ran manually');

                        fs.writeFile(coin + '_finalRedisCommands.txt', JSON.stringify(finalRedisCommands), function (err) {
                            logger.error('Could not write finalRedisCommands.txt, you are fucked.');
                        });
                    }
                    callback();
                });
            }

        ], function () {
            if (!disablePeymentProcessing) {
                paymentInterval = setTimeout(processPayments, paymentIntervalSecs * 1000);
            }

            var paymentProcessTime = Date.now() - startPaymentProcess;
			
			        paymentStats.lastCycleTime = paymentProcessTime;
					logger.info(logSystem, logComponent, 
						'=== Payment cycle #' + paymentStats.cycleCount + ' complete - ' + 
						paymentProcessTime + 'ms ===');
					
					// Log summary every 10 cycles
					if (paymentStats.cycleCount % 10 === 0) {
						logger.special(logSystem, logComponent, 
							'Payment summary - Cycles: ' + paymentStats.cycleCount + 
							', Blocks processed: ' + paymentStats.totalBlocksProcessed + 
							', Payments sent: ' + paymentStats.totalPaymentsSent);
					}
		
            logger.debug(logSystem, logComponent, 'Finished interval - time spent: '
                + paymentProcessTime + 'ms total, ' + timeSpentRedis + 'ms redis, '
                + timeSpentRPC + 'ms daemon RPC');

        });
    };


    function handleAddress(address) {
        if (address.length === 40) {
            return util.addressFromEx(poolOptions.address, address);
        }
        else return address;
    }

    var getProperAddress = function (address) {
        if (address.length === 40) {
            return util.addressFromEx(poolOptions.address, address);
        }
        else return address;
        if (address != false) {
            return handleAddress(address);
        } else {
            var addressToPay = '';

            daemon.cmd('getnewaddress', [], function (result) {
                if (result.error) {
                    callback(true);
                    return;
                }
                try {
                    addressToPay = result.data;
                }
                catch (e) {
                    logger.error(logSystem, logComponent, 'Error getting a new address. Got: ' + result.data);
                    callback(true);
                }

            }, true, true);

            return handleAddress(addressToPay);

        }
    };

}
