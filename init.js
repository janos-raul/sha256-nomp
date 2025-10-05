var fs = require('fs');
var path = require('path');
var os = require('os');
var cluster = require('cluster');

var extend = require('extend');
var redis = require('redis');

var PoolLogger = require('./libs/logUtil.js');
var CliListener = require('./libs/cliListener.js');
var PoolWorker = require('./libs/poolWorker.js');
var PaymentProcessor = require('./libs/paymentProcessor.js');
var Website = require('./libs/website.js');

var algos = require('stratum-pool/lib/algoProperties.js');

JSON.minify = JSON.minify || require("node-json-minify");

if (!fs.existsSync('config.json')) {
    console.log('config.json file does not exist. Read the installation/setup instructions.');
    process.exit(0);
}

var portalConfig = JSON.parse(JSON.minify(fs.readFileSync("config.json", { encoding: 'utf8' })));
var poolConfigs;

// Initialize logger with enhanced configuration
var logger = new PoolLogger({
    logLevel: portalConfig.logLevel || 'debug',
    logColors: portalConfig.logColors !== false,
    logDir: portalConfig.logDir || 'logs',
    logToConsole: portalConfig.logToConsole !== false,
    logToFile: portalConfig.logToFile !== false
});

// Log startup
logger.special('Master', 'Startup', 'SHA256-NOMP Pool Starting...');
logger.info('Master', 'Version', 'Node Version: ' + process.version);
logger.info('Master', 'Platform', 'OS: ' + os.platform() + ' ' + os.release());
logger.info('Master', 'Memory', 'Total: ' + (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB');
logger.info('Master', 'CPUs', 'Available: ' + os.cpus().length);

try {
    require('newrelic');
    if (cluster.isMaster) {
        logger.success('NewRelic', 'Monitor', 'New Relic monitoring initiated successfully');
    }
} catch (e) {
    logger.debug('NewRelic', 'Monitor', 'New Relic not configured (optional)');
}

// Try to give process ability to handle 100k concurrent connections
try {
    var posix = require('posix');
    try {
        posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
        logger.success('POSIX', 'Limits', 'File descriptor limit raised to 100,000');
    }
    catch (e) {
        if (cluster.isMaster)
            logger.warning('POSIX', 'Connection Limit', '(Safe to ignore) Must be ran as root to increase resource limits');
    }
    finally {
        // Find out which user used sudo through the environment variable
        var uid = parseInt(process.env.SUDO_UID);
        // Set our server's uid to that user
        if (uid) {
            process.setuid(uid);
            logger.info('POSIX', 'Connection Limit', 'Raised to 100K concurrent connections, now running as non-root user: ' + process.getuid());
        }
    }
}
catch (e) {
    if (cluster.isMaster)
        logger.debug('POSIX', 'Connection Limit', '(Safe to ignore) POSIX module not installed and resource (connection) limit was not raised');
}

if (cluster.isWorker) {
    var workerType = process.env.workerType;
    logger.info('Worker', workerType, 'Worker process started with PID: ' + process.pid);
    
    switch (workerType) {
        case 'pool':
            new PoolWorker(logger);
            break;
        case 'paymentProcessor':
            new PaymentProcessor(logger);
            break;
        case 'website':
            new Website(logger);
            break;
    }
    return;
}

// Read all pool configs from pool_configs and join them with their coin profile
var buildPoolConfigs = function () {
    logger.debug('Master', 'Config', 'Building pool configurations...');
    
    var configs = {};
    var configDir = 'pool_configs/';
    var poolConfigFiles = [];

    /* Get filenames of pool config json files that are enabled */
    fs.readdirSync(configDir).forEach(function (file) {
        if (!fs.existsSync(configDir + file) || path.extname(configDir + file) !== '.json') return;
        
        try {
            var poolOptions = JSON.parse(JSON.minify(fs.readFileSync(configDir + file, { encoding: 'utf8' })));
            if (!poolOptions.enabled) {
                logger.debug('Master', 'Config', 'Pool config ' + file + ' exists but is disabled');
                return;
            }
            poolOptions.fileName = file;
            poolConfigFiles.push(poolOptions);
            logger.info('Master', 'Config', 'Loaded pool config: ' + file);
        } catch (e) {
            logger.error('Master', 'Config', 'Error parsing pool config ' + file + ': ' + e.message);
        }
    });

    logger.info('Master', 'Config', 'Found ' + poolConfigFiles.length + ' enabled pool configs');

    /* Ensure no pool uses any of the same ports as another pool */
    for (var i = 0; i < poolConfigFiles.length; i++) {
        var ports = Object.keys(poolConfigFiles[i].ports);
        for (var f = 0; f < poolConfigFiles.length; f++) {
            if (f === i) continue;
            var portsF = Object.keys(poolConfigFiles[f].ports);
            for (var g = 0; g < portsF.length; g++) {
                if (ports.indexOf(portsF[g]) !== -1) {
                    logger.error('Master', poolConfigFiles[f].fileName, 'Has same configured port of ' + portsF[g] + ' as ' + poolConfigFiles[i].fileName);
                    process.exit(1);
                    return;
                }
            }

            if (poolConfigFiles[f].coin === poolConfigFiles[i].coin) {
                logger.error('Master', poolConfigFiles[f].fileName, 'Pool has same configured coin file coins/' + poolConfigFiles[f].coin + ' as ' + poolConfigFiles[i].fileName + ' pool');
                process.exit(1);
                return;
            }
        }
    }

    poolConfigFiles.forEach(function (poolOptions) {
        poolOptions.coinFileName = poolOptions.coin;

        var coinFilePath = 'coins/' + poolOptions.coinFileName;
        if (!fs.existsSync(coinFilePath)) {
            logger.error('Master', poolOptions.coinFileName, 'could not find file: ' + coinFilePath);
            return;
        }

        try {
            var coinProfile = JSON.parse(JSON.minify(fs.readFileSync(coinFilePath, { encoding: 'utf8' })));
            poolOptions.coin = coinProfile;
            poolOptions.coin.name = poolOptions.coin.name.toLowerCase();
            
            // Process mainnet configuration
            if (coinProfile.mainnet) {
                poolOptions.coin.mainnet.bip32.public = Buffer.from(coinProfile.mainnet.bip32.public, 'hex').readUInt32LE(0);
                poolOptions.coin.mainnet.pubKeyHash = Buffer.from(coinProfile.mainnet.pubKeyHash, 'hex').readUInt8(0);
                poolOptions.coin.mainnet.scriptHash = Buffer.from(coinProfile.mainnet.scriptHash, 'hex').readUInt8(0);
                logger.debug('Master', poolOptions.coin.name, 'Mainnet configuration processed');
            }
            
            // Process testnet configuration
            if (coinProfile.testnet) {
                poolOptions.coin.testnet.bip32.public = Buffer.from(coinProfile.testnet.bip32.public, 'hex').readUInt32LE(0);
                poolOptions.coin.testnet.pubKeyHash = Buffer.from(coinProfile.testnet.pubKeyHash, 'hex').readUInt8(0);
                poolOptions.coin.testnet.scriptHash = Buffer.from(coinProfile.testnet.scriptHash, 'hex').readUInt8(0);
                logger.debug('Master', poolOptions.coin.name, 'Testnet configuration processed');
            }

            if (poolOptions.coin.name in configs) {
                logger.error('Master', poolOptions.fileName, 'coins/' + poolOptions.coinFileName
                    + ' has same configured coin name ' + poolOptions.coin.name + ' as coins/'
                    + configs[poolOptions.coin.name].coinFileName + ' used by pool config '
                    + configs[poolOptions.coin.name].fileName);
                process.exit(1);
                return;
            }

            // Apply default pool configurations
            for (var option in portalConfig.defaultPoolConfigs) {
                if (!(option in poolOptions)) {
                    var toCloneOption = portalConfig.defaultPoolConfigs[option];
                    var clonedOption = {};
                    if (toCloneOption.constructor === Object)
                        extend(true, clonedOption, toCloneOption);
                    else
                        clonedOption = toCloneOption;
                    poolOptions[option] = clonedOption;
                    logger.debug('Master', poolOptions.coin.name, 'Applied default config for: ' + option);
                }
            }

            if (!poolOptions.blockIdentifier || poolOptions.blockIdentifier == "")
                if (portalConfig.website && portalConfig.website.stratumHost)
                    poolOptions.blockIdentifier = portalConfig.website.stratumHost;
            
            logger.info('Master', coinProfile.name, "Pool configured - Algorithm: " + coinProfile.algorithm + ", Block Identifier: " + poolOptions.blockIdentifier);

            configs[poolOptions.coin.name] = poolOptions;

            if (!(coinProfile.algorithm in algos)) {
                logger.error('Master', coinProfile.name, 'Cannot run a pool for unsupported algorithm "' + coinProfile.algorithm + '"');
                delete configs[poolOptions.coin.name];
            } else {
                logger.success('Master', coinProfile.name, 'Pool configuration complete');
            }
            
        } catch (e) {
            logger.error('Master', 'Config', 'Error processing coin profile ' + coinFilePath + ': ' + e.message);
        }
    });
    
    logger.info('Master', 'Config', 'Successfully configured ' + Object.keys(configs).length + ' pool(s)');
    return configs;
};

function roundTo(n, digits) {
    if (digits === undefined) {
        digits = 0;
    }
    var multiplicator = Math.pow(10, digits);
    n = parseFloat((n * multiplicator).toFixed(11));
    var test = (Math.round(n) / multiplicator);
    return +(test.toFixed(digits));
}

var _lastStartTimes = [];
var _lastShareTimes = [];

var spawnPoolWorkers = function () {
    logger.info('Master', 'PoolSpawner', 'Starting to spawn pool workers...');
    
    var redisConfig;
    var connection;

    Object.keys(poolConfigs).forEach(function (coin) {
        var pcfg = poolConfigs[coin];
        if (!Array.isArray(pcfg.daemons) || pcfg.daemons.length < 1) {
            logger.error('Master', coin, 'No daemons configured so a pool cannot be started for this coin.');
            delete poolConfigs[coin];
        } else if (!connection) {
            redisConfig = pcfg.redis;
            connection = redis.createClient(redisConfig.port, redisConfig.host);
            
            connection.on('ready', function () {
                logger.success('Redis', coin, 'Connected to Redis at ' + redisConfig.host + ':' + redisConfig.port);
            });
            
            connection.on('error', function (err) {
                logger.error('Redis', coin, 'Redis connection error: ' + err.message);
            });
            
            connection.on('end', function () {
                logger.warning('Redis', coin, 'Redis connection ended');
            });
        }
    });

    if (Object.keys(poolConfigs).length === 0) {
        logger.warning('Master', 'PoolSpawner', 'No pool configs exists or are enabled in pool_configs folder. No pools spawned.');
        process.exit(0);
    }

    var serializedConfigs = JSON.stringify(poolConfigs);

    var numForks = (function () {
        if (!portalConfig.clustering || !portalConfig.clustering.enabled) {
            logger.info('Master', 'Clustering', 'Clustering disabled, using single process');
            return 1;
        }
        if (portalConfig.clustering.forks === 'auto') {
            var cpuCount = os.cpus().length;
            logger.info('Master', 'Clustering', 'Auto-clustering enabled, using ' + cpuCount + ' processes');
            return cpuCount;
        }
        if (!portalConfig.clustering.forks || isNaN(portalConfig.clustering.forks)) {
            logger.warning('Master', 'Clustering', 'Invalid fork count specified, defaulting to 1');
            return 1;
        }
        logger.info('Master', 'Clustering', 'Manual clustering enabled, using ' + portalConfig.clustering.forks + ' processes');
        return portalConfig.clustering.forks;
    })();

    var poolWorkers = {};

    var createPoolWorker = function (forkId) {
        logger.debug('Master', 'PoolSpawner', 'Creating pool worker fork ' + forkId);
        
        var worker = cluster.fork({
            workerType: 'pool',
            forkId: forkId,
            pools: serializedConfigs,
            portalConfig: JSON.stringify(portalConfig)
        });
        
        worker.forkId = forkId;
        worker.type = 'pool';
        poolWorkers[forkId] = worker;
        
        logger.success('Master', 'PoolSpawner', 'Pool worker ' + forkId + ' created with PID ' + worker.process.pid);
        
        worker.on('exit', function (code, signal) {
            logger.error('Master', 'PoolSpawner', 'Fork ' + forkId + ' died (code: ' + code + ', signal: ' + signal + '), spawning replacement worker...');
            setTimeout(function () {
                createPoolWorker(forkId);
            }, 2000);
        }).on('message', function (msg) {
            switch (msg.type) {
                case 'banIP':
                    logger.warning('Security', 'Ban', 'Banning IP across all workers: ' + msg.ip);
                    Object.keys(cluster.workers).forEach(function (id) {
                        if (cluster.workers[id].type === 'pool') {
                            cluster.workers[id].send({ type: 'banIP', ip: msg.ip });
                        }
                    });
                    break;
                    
                case 'shareTrack':
                    // Get the pool config to check payment mode
                    var poolConfig = poolConfigs[msg.coin];
                    var paymentMode = (poolConfig.paymentProcessing && poolConfig.paymentProcessing.paymentMode) || 'pplnt';
                    var modeLabel = paymentMode.toUpperCase();
                    
                    // Enhanced share tracking with detailed logging
                    if (paymentMode === 'pplnt') {
                        if (msg.isValidShare && !msg.isValidBlock) {
                            var now = Date.now();
                            var lastShareTime = now;
                            var lastStartTime = now;
                            var workerAddress = msg.data.worker.split('.')[0];
                            var workerName = msg.data.worker.split('.')[1] || 'default';
                            
                            // Initialize PPLNT objects for coin
                            if (!_lastShareTimes[msg.coin]) {
                                _lastShareTimes[msg.coin] = {};
                            }
                            if (!_lastStartTimes[msg.coin]) {
                                _lastStartTimes[msg.coin] = {};
                            }
                            
                            // New miner joined
                            if (!_lastShareTimes[msg.coin][workerAddress] || !_lastStartTimes[msg.coin][workerAddress]) {
                                _lastShareTimes[msg.coin][workerAddress] = now;
                                _lastStartTimes[msg.coin][workerAddress] = now;
                                logger.info(modeLabel, msg.coin, 'New miner joined: ' + workerAddress + ' (worker: ' + workerName + ')');
                            }
                            
                            // Grab last times from memory objects
                            if (_lastShareTimes[msg.coin][workerAddress] != null && _lastShareTimes[msg.coin][workerAddress] > 0) {
                                lastShareTime = _lastShareTimes[msg.coin][workerAddress];
                                lastStartTime = _lastStartTimes[msg.coin][workerAddress];
                            }
                            
                            var redisCommands = [];
                            var timeChangeSec = roundTo(Math.max(now - lastShareTime, 0) / 1000, 4);
                            
                            if (timeChangeSec < 900) {
                                // Loyal miner keeps mining
                                redisCommands.push(['hincrbyfloat', msg.coin + ':shares:timesCurrent', workerAddress, timeChangeSec]);
                                connection.multi(redisCommands).exec(function (err, replies) {
                                    if (err) {
                                        logger.error(modeLabel, msg.coin, 'Redis error updating time shares: ' + JSON.stringify(err));
                                    } else {
                                        logger.debug(modeLabel, msg.coin, 'Time share updated for ' + workerAddress + ': +' + timeChangeSec + 's');
                                    }
                                });
                            } else {
                                // Miner rejoined after timeout
                                _lastStartTimes[msg.coin][workerAddress] = now;
                                logger.info(modeLabel, msg.coin, 'Miner rejoined after ' + timeChangeSec + 's: ' + workerAddress);
                            }
                            
                            // Track last time share
                            _lastShareTimes[msg.coin][workerAddress] = now;
                        }
                        
                        if (msg.isValidBlock) {
                            logger.success(modeLabel, msg.coin, 'Block found! Resetting PPLNT shares for next round');
                            _lastShareTimes[msg.coin] = {};
                            _lastStartTimes[msg.coin] = {};
                        }
                    } else if (paymentMode === 'prop') {
                        // PROP mode logging
                        if (msg.isValidShare && !msg.isValidBlock && !msg.isSoloMining) {
                            var workerAddress = msg.data.worker.split('.')[0];
                            var workerName = msg.data.worker.split('.')[1] || 'default';
                            
                            if (!_lastShareTimes[msg.coin]) {
                                _lastShareTimes[msg.coin] = {};
                            }
                            if (!_lastShareTimes[msg.coin][workerAddress]) {
                                logger.info('PROP', msg.coin, 'New miner joined round: ' + workerAddress + ' (worker: ' + workerName + ')');
                                _lastShareTimes[msg.coin][workerAddress] = Date.now();
                            }
                        }
                        
                        if (msg.isValidBlock) {
                            var minerCount = Object.keys(_lastShareTimes[msg.coin] || {}).length;
                            logger.success('PROP', msg.coin, 'Block found! Round had ' + minerCount + ' miners. Resetting for next round');
                            _lastShareTimes[msg.coin] = {};
                        }
                    }
                    break;
                    
                case 'workerStats':
                    // Log worker statistics
                    logger.logStructured({
                        severity: 'info',
                        system: 'Stats',
                        component: msg.coin,
                        text: 'Worker statistics update',
                        data: {
                            worker: msg.worker,
                            hashrate: msg.hashrate,
                            shares: msg.shares,
                            difficulty: msg.difficulty
                        }
                    });
                    break;
            }
        });
    };

    var i = 0;
    var spawnInterval = setInterval(function () {
        createPoolWorker(i);
        i++;
        if (i === numForks) {
            clearInterval(spawnInterval);
            logger.success('Master', 'PoolSpawner', 'Successfully spawned ' + Object.keys(poolConfigs).length + ' pool(s) on ' + numForks + ' thread(s)');
        }
    }, 250);
};

var startCliListener = function () {
    var cliPort = portalConfig.cliPort;
    
    logger.info('Master', 'CLI', 'Starting CLI listener on port ' + cliPort);
    
    var listener = new CliListener(cliPort, logger);
    listener.on('log', function (text) {
        logger.debug('Master', 'CLI', text);
    }).on('command', function (command, params, options, reply) {
        logger.info('Master', 'CLI', 'Received command: ' + command + ' with params: ' + JSON.stringify(params));
        
        switch (command) {
            case 'blocknotify':
                Object.keys(cluster.workers).forEach(function (id) {
                    cluster.workers[id].send({ type: 'blocknotify', coin: params[0], hash: params[1] });
                });
                logger.info('Master', 'CLI', 'Block notification sent for ' + params[0] + ' - hash: ' + params[1]);
                reply('Pool workers notified');
                break;
                
            case 'coinswitch':
                processCoinSwitchCommand(params, options, reply);
                break;
                
            case 'reloadpool':
                Object.keys(cluster.workers).forEach(function (id) {
                    cluster.workers[id].send({ type: 'reloadpool', coin: params[0] });
                });
                logger.info('Master', 'CLI', 'Pool reload requested for ' + params[0]);
                reply('reloaded pool ' + params[0]);
                break;
                
            case 'stats':
                var metrics = logger.getMetrics();
                reply(JSON.stringify(metrics, null, 2));
                break;
                
            default:
                logger.warning('Master', 'CLI', 'Unrecognized command: ' + command);
                reply('unrecognized command "' + command + '"');
                break;
        }
    }).start();
    
    logger.success('Master', 'CLI', 'CLI listener started successfully on port ' + cliPort);
};

var processCoinSwitchCommand = function (params, options, reply) {
    var logSystem = 'CLI';
    var logComponent = 'coinswitch';

    var replyError = function (msg) {
        reply(msg);
        logger.error(logSystem, logComponent, msg);
    };

    if (!params[0]) {
        replyError('Coin name required');
        return;
    }

    if (!params[1] && !options.algorithm) {
        replyError('If switch key is not provided then algorithm options must be specified');
        return;
    }
    else if (params[1] && !portalConfig.switching[params[1]]) {
        replyError('Switch key not recognized: ' + params[1]);
        return;
    }
    else if (options.algorithm && !Object.keys(portalConfig.switching).filter(function (s) {
        return portalConfig.switching[s].algorithm === options.algorithm;
    })[0]) {
        replyError('No switching options contain the algorithm ' + options.algorithm);
        return;
    }

    var messageCoin = params[0].toLowerCase();
    var newCoin = Object.keys(poolConfigs).filter(function (p) {
        return p.toLowerCase() === messageCoin;
    })[0];

    if (!newCoin) {
        replyError('Switch message to coin that is not recognized: ' + messageCoin);
        return;
    }

    var switchNames = [];

    if (params[1]) {
        switchNames.push(params[1]);
    }
    else {
        for (var name in portalConfig.switching) {
            if (portalConfig.switching[name].enabled && portalConfig.switching[name].algorithm === options.algorithm)
                switchNames.push(name);
        }
    }

    switchNames.forEach(function (name) {
        if (poolConfigs[newCoin].coin.algorithm !== portalConfig.switching[name].algorithm) {
            replyError('Cannot switch a '
                + portalConfig.switching[name].algorithm
                + ' algo pool to coin ' + newCoin + ' with ' + poolConfigs[newCoin].coin.algorithm + ' algo');
            return;
        }

        logger.info(logSystem, logComponent, 'Switching ' + name + ' to coin ' + newCoin);
        
        Object.keys(cluster.workers).forEach(function (id) {
            cluster.workers[id].send({ type: 'coinswitch', coin: newCoin, switchName: name });
        });
    });

    logger.success(logSystem, logComponent, 'Switch message sent to all pool workers');
    reply('Switch message sent to pool workers');
};

var startPaymentProcessor = function () {
    var enabledForAny = false;
    for (var pool in poolConfigs) {
        var p = poolConfigs[pool];
        var enabled = p.enabled && p.paymentProcessing && p.paymentProcessing.enabled;
        if (enabled) {
            enabledForAny = true;
            break;
        }
    }

    if (!enabledForAny) {
        logger.info('Master', 'PaymentProcessor', 'Payment processing is not enabled for any pools');
        return;
    }

    logger.info('Master', 'PaymentProcessor', 'Starting payment processor...');
    
    var worker = cluster.fork({
        workerType: 'paymentProcessor',
        pools: JSON.stringify(poolConfigs)
    });
    
    logger.success('Master', 'PaymentProcessor', 'Payment processor started with PID ' + worker.process.pid);
    
    worker.on('exit', function (code, signal) {
        logger.error('Master', 'Payment Processor', 'Payment processor died (code: ' + code + ', signal: ' + signal + '), spawning replacement...');
        setTimeout(function () {
            startPaymentProcessor(poolConfigs);
        }, 2000);
    });
};

var startWebsite = function () {
    if (!portalConfig.website.enabled) {
        logger.info('Master', 'Website', 'Website is disabled in configuration');
        return;
    }

    logger.info('Master', 'Website', 'Starting website on port ' + (portalConfig.website.port || 8080));
    
    var worker = cluster.fork({
        workerType: 'website',
        pools: JSON.stringify(poolConfigs),
        portalConfig: JSON.stringify(portalConfig)
    });
    
    logger.success('Master', 'Website', 'Website started with PID ' + worker.process.pid);
    
    worker.on('exit', function (code, signal) {
        logger.error('Master', 'Website', 'Website process died (code: ' + code + ', signal: ' + signal + '), spawning replacement...');
        setTimeout(function () {
            startWebsite(portalConfig, poolConfigs);
        }, 2000);
    });
};


// Main initialization
(function init() {
    logger.special('Master', 'Init', '=== SHA256-NOMP Pool Initialization ===');
    
    // Build pool configurations
    poolConfigs = buildPoolConfigs();
    
    // Start all components
    spawnPoolWorkers();
    startPaymentProcessor();
    startWebsite();
    startCliListener();
    
    logger.special('Master', 'Init', '=== Pool initialization complete ===');
    
    // Log summary
    setTimeout(function() {
        logger.info('Master', 'Summary', 'Pool is running with:');
        logger.info('Master', 'Summary', '  - Pools: ' + Object.keys(poolConfigs).length);
        logger.info('Master', 'Summary', '  - Workers: ' + Object.keys(cluster.workers).length);
		var paymentEnabled = false;
		Object.keys(poolConfigs).forEach(function(coin) {
			if (poolConfigs[coin].paymentProcessing && poolConfigs[coin].paymentProcessing.enabled) {
				paymentEnabled = true;
			}
		});
		logger.info('Master', 'Summary', '  - Payment Processor: ' + (paymentEnabled ? 'Enabled' : 'Disabled'));
    }, 1000);
})();