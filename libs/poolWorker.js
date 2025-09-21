var Stratum = require('stratum-pool');
var redis   = require('redis');
var net     = require('net');

var MposCompatibility = require('./mposCompatibility.js');
var ShareProcessor = require('./shareProcessor.js');

module.exports = function(logger){

    var _this = this;

    var poolConfigs  = JSON.parse(process.env.pools);
    var portalConfig = JSON.parse(process.env.portalConfig);

    var forkId = process.env.forkId;

    var pools = {};
    var proxySwitch = {};
    
    // Store worker passwords for solo detection
    var workerPasswords = {};
    
    // Performance tracking
    var performanceStats = {
        connections: {},
        shares: {},
        blocks: {}
    };

    // Initialize logger for this worker
    logger.info('PoolWorker', 'Init', 'Fork ' + forkId, 'Starting pool worker process...');

    var redisClient = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
    
    // Redis connection logging
    redisClient.on('ready', function() {
        logger.success('PoolWorker', 'Redis', 'Fork ' + forkId, 'Connected to Redis at ' + portalConfig.redis.host + ':' + portalConfig.redis.port);
    });
    
    redisClient.on('error', function(err) {
        logger.error('PoolWorker', 'Redis', 'Fork ' + forkId, 'Redis connection error: ' + err.message);
    });
    
    redisClient.on('end', function() {
        logger.warning('PoolWorker', 'Redis', 'Fork ' + forkId, 'Redis connection closed');
    });
    
    if (portalConfig.redis.password) {
        redisClient.auth(portalConfig.redis.password, function(err) {
            if (err) {
                logger.error('PoolWorker', 'Redis', 'Fork ' + forkId, 'Redis auth failed: ' + err.message);
            } else {
                logger.success('PoolWorker', 'Redis', 'Fork ' + forkId, 'Redis authentication successful');
            }
        });
    }
    
    //Handle messages from master process sent via IPC
    process.on('message', function(message) {
        var logSubCat = 'Thread ' + (parseInt(forkId) + 1);
        
        switch(message.type){
            case 'banIP':
                logger.warning('PoolWorker', 'Security', logSubCat, 'Banning IP address: ' + message.ip);
                var bannedCount = 0;
                for (var p in pools){
                    if (pools[p].stratumServer) {
                        pools[p].stratumServer.addBannedIP(message.ip);
                        bannedCount++;
                    }
                }
                logger.info('PoolWorker', 'Security', logSubCat, 'IP ' + message.ip + ' banned on ' + bannedCount + ' pools');
                break;

            case 'blocknotify':
                var messageCoin = message.coin.toLowerCase();
                var poolTarget = Object.keys(pools).filter(function(p){
                    return p.toLowerCase() === messageCoin;
                })[0];

                if (poolTarget) {
                    logger.info('PoolWorker', 'BlockNotify', logSubCat, 
                        'Processing block notification for ' + poolTarget + ' - Hash: ' + message.hash);
                    pools[poolTarget].processBlockNotify(message.hash, 'blocknotify script');
                } else {
                    logger.warning('PoolWorker', 'BlockNotify', logSubCat, 
                        'Received block notification for unknown pool: ' + messageCoin);
                }
                break;

            case 'coinswitch':
                var logSystem = 'Proxy';
                var logComponent = 'Switch';
                var switchName = message.switchName;
                var newCoin = message.coin;
                var algo = poolConfigs[newCoin].coin.algorithm;
                var newPool = pools[newCoin];
                var oldCoin = proxySwitch[switchName].currentPool;
                var oldPool = pools[oldCoin];
                var proxyPorts = Object.keys(proxySwitch[switchName].ports);

                if (newCoin == oldCoin) {
                    logger.debug(logSystem, logComponent, logSubCat, 'Switch would have no effect - ignoring switch to ' + newCoin);
                    break;
                }

                logger.info(logSystem, logComponent, logSubCat, 
                    'Switching ' + algo + ' miners from ' + oldCoin + ' to ' + newCoin);

                if (newPool) {
                    var switchedMiners = 0;
                    oldPool.relinquishMiners(
                        function (miner, cback) {
                            var shouldSwitch = proxyPorts.indexOf(miner.client.socket.localPort.toString()) !== -1;
                            if (shouldSwitch) switchedMiners++;
                            cback(shouldSwitch);
                        },
                        function (clients) {
                            newPool.attachMiners(clients);
                            logger.success(logSystem, logComponent, logSubCat, 
                                'Switched ' + switchedMiners + ' miners from ' + oldCoin + ' to ' + newCoin);
                        }
                    );
                    proxySwitch[switchName].currentPool = newCoin;

                    redisClient.hset('proxyState', algo, newCoin, function(error, obj) {
                        if (error) {
                            logger.error(logSystem, logComponent, logSubCat, 'Redis error saving proxy state: ' + JSON.stringify(error));
                        } else {
                            logger.debug(logSystem, logComponent, logSubCat, 'Proxy state saved to Redis for ' + algo);
                        }
                    });
                }
                break;
                
            case 'reloadpool':
                logger.info('PoolWorker', 'Reload', logSubCat, 'Reloading pool: ' + message.coin);
                // Add pool reload logic here if needed
                break;
        }
    });

    // Initialize each pool
    Object.keys(poolConfigs).forEach(function(coin) {
        var poolOptions = poolConfigs[coin];
        var logSystem = 'Pool';
        var logComponent = coin;
        var logSubCat = 'Thread ' + (parseInt(forkId) + 1);

        logger.info(logSystem, logComponent, logSubCat, 'Initializing pool for ' + coin);

        // Initialize stats for this coin
        if (!performanceStats.connections[coin]) {
            performanceStats.connections[coin] = { current: 0, total: 0 };
        }
        if (!performanceStats.shares[coin]) {
            performanceStats.shares[coin] = { valid: 0, invalid: 0, total: 0 };
        }
        if (!performanceStats.blocks[coin]) {
            performanceStats.blocks[coin] = { valid: 0, invalid: 0, solo: 0 };
        }

        var handlers = {
            auth: function(){},
            share: function(){},
            diff: function(){}
        };

        //Functions required for MPOS compatibility
        if (poolOptions.mposMode && poolOptions.mposMode.enabled){
            logger.info(logSystem, logComponent, logSubCat, 'MPOS compatibility mode enabled');
            var mposCompat = new MposCompatibility(logger, poolOptions);

            handlers.auth = function(port, workerName, password, authCallback){
                logger.debug(logSystem, logComponent, logSubCat, '[MPOS Auth] Worker: ' + workerName);
                mposCompat.handleAuth(workerName, password, authCallback);
            };

            handlers.share = function(isValidShare, isValidBlock, data){
                logger.debug(logSystem, logComponent, logSubCat, '[MPOS Share] Valid: ' + isValidShare + ', Block: ' + isValidBlock);
                mposCompat.handleShare(isValidShare, isValidBlock, data);
            };

            handlers.diff = function(workerName, diff){
                logger.debug(logSystem, logComponent, logSubCat, '[MPOS Diff] Worker: ' + workerName + ', Diff: ' + diff);
                mposCompat.handleDifficultyUpdate(workerName, diff);
            }
        }
        //Functions required for internal payment processing
        else {
            logger.info(logSystem, logComponent, logSubCat, 'Using internal payment processing');
            var shareProcessor = new ShareProcessor(logger, poolOptions);
            
			handlers.auth = function (port, workerName, password, authCallback) {
				var authStart = Date.now();
				const [wallet, worker] = (workerName || '').split('.', 2);
				
				// If validation is disabled, accept all
				if (poolOptions.validateWorkerUsername !== true) {
					logger.debug(logSystem, logComponent, logSubCat, 
						'[Auth] Validation disabled, auto-accepting: ' + workerName);
					return authCallback(true);
				}
				
				// Get expected address format from coin config
				const addressValidation = poolOptions.coin.addressValidation;
				
				if (addressValidation && addressValidation.addressPrefix) {
					const expectedPrefix = addressValidation.addressPrefix;
					const minLength = addressValidation.minLength || 20;
					const maxLength = addressValidation.maxLength || 100;
					
					// Build the expected address pattern based on prefix
					// Support both bech32 (prefix + '1') and other formats
					const expectedStart = expectedPrefix + '1';
					const walletLower = wallet.toLowerCase();
					
					// Check if address starts with expected prefix
					if (!walletLower.startsWith(expectedStart)) {
						// Log what we got vs what we expected
						const actualPrefix = wallet.substring(0, Math.min(4, wallet.length));
						
						// Detect common wrong coin types for better logging
						let wrongCoinType = null;
						if (wallet.match(/^bc1/i)) wrongCoinType = 'Bitcoin Bech32';
						else if (wallet.match(/^tb1/i)) wrongCoinType = 'Bitcoin Testnet';
						else if (wallet.match(/^[13]/)) wrongCoinType = 'Bitcoin Legacy';
						else if (wallet.match(/^ltc1/i)) wrongCoinType = 'Litecoin Bech32';
						else if (wallet.match(/^[LM]/)) wrongCoinType = 'Litecoin Legacy';
						
						if (wrongCoinType) {
							logger.warning(logSystem, logComponent, logSubCat, 
								`[Auth] REJECTED ${wrongCoinType} address on ${poolOptions.coin.name} pool: ${wallet} - Expected prefix: ${expectedStart}`);
						} else {
							logger.warning(logSystem, logComponent, logSubCat, 
								`[Auth] Invalid address prefix for ${poolOptions.coin.name}: ${actualPrefix}... - Expected: ${expectedStart}`);
						}
						return authCallback(false);
					}
					
					// Check length constraints
					if (wallet.length < minLength) {
						logger.warning(logSystem, logComponent, logSubCat, 
							`[Auth] Address too short for ${poolOptions.coin.name}: ${wallet.length} < ${minLength}`);
						return authCallback(false);
					}
					
					if (wallet.length > maxLength) {
						logger.warning(logSystem, logComponent, logSubCat, 
							`[Auth] Address too long for ${poolOptions.coin.name}: ${wallet.length} > ${maxLength}`);
						return authCallback(false);
					}
					
					// Additional bech32 character validation if it's a bech32 address
					if (walletLower.startsWith(expectedPrefix + '1')) {
						// Bech32 can only contain specific characters after the separator
						const bech32Regex = new RegExp(`^${expectedPrefix}1[ac-hj-np-z02-9]+$`);
						if (!bech32Regex.test(walletLower)) {
							logger.warning(logSystem, logComponent, logSubCat, 
								`[Auth] Invalid bech32 characters in ${poolOptions.coin.name} address: ${wallet}`);
							return authCallback(false);
						}
					}
					
					// Valid address format for this pool
					var authTime = Date.now() - authStart;
					logger.debug(logSystem, logComponent, logSubCat, 
						`[Auth] Valid ${poolOptions.coin.name} address: ${wallet} - Time: ${authTime}ms`);
					return authCallback(true);
					
				} else if (addressValidation && addressValidation.validateWorkerUsername === true) {
					// Has validation enabled but no specific prefix - use daemon validation
					logger.debug(logSystem, logComponent, logSubCat, 
						`[Auth] No address prefix configured for ${poolOptions.coin.name}, using daemon validation: ${wallet}`);
						
					pool.daemon.cmd('validateaddress', [wallet], function (results) {
						var authTime = Date.now() - authStart;
						const isValid = results.some(r => r.response && r.response.isvalid);
						
						if (!isValid) {
							logger.warning(logSystem, logComponent, logSubCat, 
								`[Auth] Daemon rejected ${poolOptions.coin.name} address: ${wallet} - Time: ${authTime}ms`);
						} else {
							logger.debug(logSystem, logComponent, logSubCat, 
								`[Auth] Daemon validated ${poolOptions.coin.name} address: ${wallet} - Time: ${authTime}ms`);
						}
						
						authCallback(isValid);
					});
					return; // Important: return here to wait for daemon response
					
				} else {
					// No validation configured - accept common formats but warn
					logger.debug(logSystem, logComponent, logSubCat, 
						`[Auth] No address validation configured for ${poolOptions.coin.name}, using generic validation`);
					
					// Accept common cryptocurrency address formats
					const commonFormats = [
						/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,     // Legacy P2PKH/P2SH
						/^[a-z0-9]{2,}1[ac-hj-np-z02-9]{11,71}$/i // Generic Bech32
					];
					
					const isValidFormat = commonFormats.some(regex => regex.test(wallet));
					
					if (isValidFormat) {
						var authTime = Date.now() - authStart;
						logger.debug(logSystem, logComponent, logSubCat, 
							`[Auth] Generic format accepted for ${poolOptions.coin.name}: ${wallet} - Time: ${authTime}ms`);
						return authCallback(true);
					}
					
					// Invalid format
					logger.warning(logSystem, logComponent, logSubCat, 
						`[Auth] Invalid address format for ${poolOptions.coin.name}: ${wallet}`);
					return authCallback(false);
				}
			};

            handlers.share = function(isValidShare, isValidBlock, data){
                shareProcessor.handleShare(isValidShare, isValidBlock, data);
		   };
		}
        
	var authorizeFN = function(ip, port, workerName, password, callback) {
		var authStart = Date.now();
		
		logger.info(logSystem, logComponent, logSubCat, 
			'[Connection] New miner connecting from ' + ip + ':' + port + ' as ' + workerName);

		// Store password for this worker
		if (password) {
			workerPasswords[workerName] = password;
			
			var passwordLower = password.toLowerCase();
			if (passwordLower === 'solo' || passwordLower.includes('m=solo') || passwordLower.includes('solo=true')) {
				logger.info(logSystem, logComponent, logSubCat, 
					'[Solo Mining] Worker ' + workerName + ' identified as SOLO miner');
			}
		}

		performanceStats.connections[coin].total++;
		performanceStats.connections[coin].current++;

		handlers.auth(port, workerName, password, function(authorized) {
			var authTime = Date.now() - authStart;
			
			if (authorized) {
				logger.success(logSystem, logComponent, logSubCat, 
					'[Auth] Authorized ' + workerName + ' from ' + ip + ' - Time: ' + authTime + 'ms');
				callback({
					error: null,
					authorized: authorized,
					disconnect: false
				});
			} else {
				logger.warning(logSystem, logComponent, logSubCat, 
					'[Auth] Unauthorized ' + workerName + ' from ' + ip + ' - Time: ' + authTime + 'ms');
				performanceStats.connections[coin].current--;
				
				// Build a helpful message based on what's configured
				let errorMessage = "check address ! check pool !";
				
				// If we have addressValidation config, provide more specific help
				if (poolOptions.coin && poolOptions.coin.addressValidation && poolOptions.coin.addressValidation.addressPrefix) {
					const prefix = poolOptions.coin.addressValidation.addressPrefix;
					errorMessage = `check address ! check pool ! ${poolOptions.coin.name} addresses must start with '${prefix}1'`;
				}
				
				callback({
					error: [24, errorMessage, null],
					authorized: false,
					disconnect: true
				});
			}
		});
	};		

    var pool = Stratum.createPool(poolOptions, authorizeFN, logger);
        
        // Pool event handlers with comprehensive logging
        pool.on('started', function(){
            logger.success(logSystem, logComponent, logSubCat, 
                'Stratum pool started on ports: ' + Object.keys(poolOptions.ports).join(', '));
            _this.setDifficultyForProxyPort(pool, coin, poolOptions.coin.algorithm);
        });

        pool.on('stratumTimeout', function(minerSocket){
            logger.warning(logSystem, logComponent, logSubCat, 
                'Miner timed out: ' + minerSocket.remoteAddress);
            performanceStats.connections[coin].current--;
        });

        pool.on('minerDisconnected', function(minerSocket){
            logger.info(logSystem, logComponent, logSubCat, 
                'Miner disconnected: ' + minerSocket.remoteAddress);
            performanceStats.connections[coin].current--;
        });

        pool.on('share', function(isValidShare, isValidBlock, data){
            var shareStart = Date.now();
            
            // Clean up worker name
            if(data.worker != undefined)
                data.worker = data.worker.replace(/:/g,"-");
            
            // DETECT SOLO MINING FROM STORED PASSWORD
            var isSoloMining = false;
            var password = workerPasswords[data.worker] || '';
            
            if (password) {
                var passwordLower = password.toLowerCase();
                if (passwordLower === 'solo' || 
                    passwordLower.includes('m=solo') || 
                    passwordLower.includes('solo=true')) {
                    isSoloMining = true;
                }
            }
            
            // ADD SOLO FLAG TO DATA BEFORE PASSING TO HANDLER
            data.isSoloMining = isSoloMining;
            
            // Update share stats
            performanceStats.shares[coin].total++;
            if (isValidShare) {
                performanceStats.shares[coin].valid++;
            } else {
                performanceStats.shares[coin].invalid++;
            }
            
            // Enhanced logging for blocks
            if (data.blockHash) {
                if (!isValidBlock) {
                    logger.error(logSystem, logComponent, logSubCat, 
                        '[INVALID BLOCK] Rejected by daemon - Hash: ' + data.blockHash + 
                        ', Height: ' + data.height + ', Worker: ' + data.worker + 
                        (isSoloMining ? ' [SOLO]' : ' [POOL]'));
                    performanceStats.blocks[coin].invalid++;
                } else {
                    var blockType = isSoloMining ? 'SOLO BLOCK' : 'POOL BLOCK';
                    logger.special(logSystem, logComponent, logSubCat, 
                        '[' + blockType + ' FOUND!] Hash: ' + data.blockHash + 
                        ', Height: ' + data.height + ', Worker: ' + data.worker + 
                        ', Reward: ' + (data.blockReward ? (data.blockReward / 100000000) + ' coins' : 'pending'));
                    
                    performanceStats.blocks[coin].valid++;
                    if (isSoloMining) performanceStats.blocks[coin].solo++;
                    
                    // Log block details to structured data
                    logger.logStructured({
                        severity: 'special',
                        system: logSystem,
                        component: logComponent,
                        text: 'Block Found',
                        data: {
                            type: blockType,
                            hash: data.blockHash,
                            height: data.height,
                            worker: data.worker,
                            difficulty: data.difficulty,
                            shareDiff: data.shareDiff,
                            reward: data.blockReward
                        }
                    });
                }
            }

            // Enhanced share logging
            if (isValidShare) {
                var shareTime = Date.now() - shareStart;
                
                if(data.shareDiff > 1000000000) {
                    logger.warning(logSystem, logComponent, logSubCat, 
                        '[HIGH DIFF SHARE] Diff: ' + data.shareDiff + ' by ' + data.worker);
                }
                
                var shareType = isSoloMining ? 'SOLO' : 'POOL';
                logger.debug(logSystem, logComponent, logSubCat, 
                    '[' + shareType + ' Share] Accepted - Worker: ' + data.worker + 
                    ', Diff: ' + data.difficulty + '/' + data.shareDiff + 
                    ', Time: ' + shareTime + 'ms');
                    
                // Log every 1000th share with stats
                if (performanceStats.shares[coin].valid % 1000 === 0) {
                    var validRatio = (performanceStats.shares[coin].valid / performanceStats.shares[coin].total * 100).toFixed(2);
                    logger.info(logSystem, logComponent, logSubCat, 
                        '[Milestone] ' + performanceStats.shares[coin].valid + ' valid shares processed - ' +
                        'Acceptance rate: ' + validRatio + '%');
                }
            } else if (!isValidShare) {
                logger.warning(logSystem, logComponent, logSubCat, 
                    '[Invalid Share] Rejected - Worker: ' + data.worker + 
                    ', Reason: ' + (data.error || 'unknown') + 
                    ', Job: ' + data.job);
                    
                // Log high invalid share rates
                if (performanceStats.shares[coin].invalid > 10) {
                    var invalidRatio = (performanceStats.shares[coin].invalid / performanceStats.shares[coin].total * 100).toFixed(2);
                    if (invalidRatio > 5) {
                        logger.warning(logSystem, logComponent, logSubCat, 
                            '[High Invalid Rate] ' + invalidRatio + '% shares rejected');
                    }
                }
            }

            // Pass to share handler with solo flag included
            handlers.share(isValidShare, isValidBlock, data);

            // Send to master for pplnt time tracking
            process.send({
                type: 'shareTrack', 
                thread: (parseInt(forkId)+1), 
                coin: poolOptions.coin.name, 
                isValidShare: isValidShare, 
                isValidBlock: isValidBlock, 
                isSoloMining: isSoloMining,
                data: data
            });
        });

        pool.on('difficultyUpdate', function(workerName, diff){
            logger.debug(logSystem, logComponent, logSubCat, 
                '[Difficulty] Updated for ' + workerName + ' to ' + diff);
            handlers.diff(workerName, diff);
        });

        pool.on('log', function(severity, text) {
            logger[severity](logSystem, logComponent, logSubCat, text);
        });
        
        pool.start();
        pools[poolOptions.coin.name] = pool;
        
        logger.success(logSystem, logComponent, logSubCat, 'Pool initialized and running');
    });

    // Proxy switching setup
    if (portalConfig.switching) {
        var logSystem = 'Switching';
        var logComponent = 'Setup';
        var logSubCat = 'Thread ' + (parseInt(forkId) + 1);

        var proxyState = {};

        logger.info(logSystem, logComponent, logSubCat, 'Initializing proxy switching...');

        redisClient.hgetall("proxyState", function(error, obj) {
            if (!error && obj) {
                proxyState = obj;
                logger.info(logSystem, logComponent, logSubCat, 
                    'Loaded proxy state from Redis: ' + JSON.stringify(proxyState));
            } else if (error) {
                logger.warning(logSystem, logComponent, logSubCat, 
                    'Could not load proxy state from Redis: ' + error.message);
            }

            Object.keys(portalConfig.switching).forEach(function(switchName) {
                var algorithm = portalConfig.switching[switchName].algorithm;

                if (!portalConfig.switching[switchName].enabled) {
                    logger.debug(logSystem, logComponent, logSubCat, 
                        'Proxy switch "' + switchName + '" is disabled');
                    return;
                }

                var initalPool = proxyState.hasOwnProperty(algorithm) ? proxyState[algorithm] : _this.getFirstPoolForAlgorithm(algorithm);
                proxySwitch[switchName] = {
                    algorithm: algorithm,
                    ports: portalConfig.switching[switchName].ports,
                    currentPool: initalPool,
                    servers: []
                };

                logger.info(logSystem, logComponent, logSubCat, 
                    'Setting up proxy "' + switchName + '" for ' + algorithm + ' algorithm');

                Object.keys(proxySwitch[switchName].ports).forEach(function(port){
                    var connectionCount = 0;
                    
                    var f = net.createServer(function(socket) {
                        connectionCount++;
                        var currentPool = proxySwitch[switchName].currentPool;

                        logger.info(logSystem, 'ProxyConnect', logSubCat, 
                            'New proxy connection #' + connectionCount + ' to "' + switchName + 
                            '" from ' + socket.remoteAddress + ':' + socket.remotePort + 
                            ' on port ' + port + ' -> routing to ' + currentPool);

                        if (pools[currentPool]) {
                            pools[currentPool].getStratumServer().handleNewClient(socket);
                        } else {
                            logger.warning(logSystem, 'ProxyConnect', logSubCat, 
                                'Pool ' + currentPool + ' not available, falling back to ' + initalPool);
                            pools[initalPool].getStratumServer().handleNewClient(socket);
                        }
                        
                        socket.on('close', function() {
                            connectionCount--;
                            logger.debug(logSystem, 'ProxyDisconnect', logSubCat, 
                                'Proxy connection closed. Active connections: ' + connectionCount);
                        });

                    }).listen(parseInt(port), function() {
                        logger.success(logSystem, logComponent, logSubCat, 
                            'Proxy "' + switchName + '" listening for ' + algorithm + 
                            ' on port ' + port + ' -> ' + proxySwitch[switchName].currentPool);
                    });
                    
                    f.on('error', function(err) {
                        logger.error(logSystem, logComponent, logSubCat, 
                            'Failed to bind proxy port ' + port + ': ' + err.message);
                    });
                    
                    proxySwitch[switchName].servers.push(f);
                });
            });
        });
    }

    this.getFirstPoolForAlgorithm = function(algorithm) {
        var foundCoin = "";
        Object.keys(poolConfigs).forEach(function(coinName) {
            if (poolConfigs[coinName].coin.algorithm == algorithm) {
                if (foundCoin === "")
                    foundCoin = coinName;
            }
        });
        logger.debug('PoolWorker', 'Algorithm', 'Fork ' + forkId, 
            'First pool for ' + algorithm + ': ' + (foundCoin || 'none'));
        return foundCoin;
    };

    this.setDifficultyForProxyPort = function(pool, coin, algo) {
        logger.debug('PoolWorker', coin, 'Fork ' + forkId, 
            'Configuring proxy difficulties for ' + algo);

        var diffConfigs = 0;
        Object.keys(portalConfig.switching).forEach(function(switchName) {
            if (!portalConfig.switching[switchName].enabled) return;

            var switchAlgo = portalConfig.switching[switchName].algorithm;
            if (pool.options.coin.algorithm !== switchAlgo) return;

            for (var port in portalConfig.switching[switchName].ports) {
                if (portalConfig.switching[switchName].ports[port].varDiff) {
                    pool.setVarDiff(port, portalConfig.switching[switchName].ports[port].varDiff);
                    diffConfigs++;
                    logger.debug('PoolWorker', coin, 'Fork ' + forkId, 
                        'Set varDiff for port ' + port);
                }

                if (portalConfig.switching[switchName].ports[port].diff){
                    if (!pool.options.ports.hasOwnProperty(port))
                        pool.options.ports[port] = {};
                    pool.options.ports[port].diff = portalConfig.switching[switchName].ports[port].diff;
                    diffConfigs++;
                    logger.debug('PoolWorker', coin, 'Fork ' + forkId, 
                        'Set fixed diff ' + portalConfig.switching[switchName].ports[port].diff + ' for port ' + port);
                }
            }
        });
        
        if (diffConfigs > 0) {
            logger.info('PoolWorker', coin, 'Fork ' + forkId, 
                'Configured ' + diffConfigs + ' proxy difficulty settings');
        }
    };
    
    // Log stats periodically
    setInterval(function() {
        Object.keys(poolConfigs).forEach(function(coin) {
            if (performanceStats.connections[coin].current > 0 || performanceStats.shares[coin].total > 0) {
                logger.info('PoolWorker', coin, 'Fork ' + forkId, 
                    'Stats - Connections: ' + performanceStats.connections[coin].current + 
                    ', Shares: ' + performanceStats.shares[coin].valid + '/' + performanceStats.shares[coin].total + 
                    ', Blocks: ' + performanceStats.blocks[coin].valid + ' (Solo: ' + performanceStats.blocks[coin].solo + ')');
            }
        });
    }, 300000); // Every 5 minutes
};