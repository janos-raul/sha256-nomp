var redis = require('redis');

/*
Enhanced share processor with comprehensive logging for SHA256-NOMP
Handles both POOL and SOLO mining with proper separation and tracking
*/

module.exports = function(logger, poolConfig){

    var redisConfig = poolConfig.redis;
    var coin = poolConfig.coin.name;
    var forkId = process.env.forkId;
    
    var logSystem = 'ShareProcessor';
    var logComponent = coin;
    var logSubCat = 'Thread ' + (parseInt(forkId) + 1);
    
    // Statistics tracking
    var stats = {
        shares: { pool: 0, solo: 0, invalid: 0 },
        blocks: { pool: 0, solo: 0, orphaned: 0 },
        workers: new Set(),
        lastBlock: null,
        startTime: Date.now()
    };
    
    // Performance tracking
    var perfStats = {
        redisWrites: 0,
        redisErrors: 0,
        avgProcessTime: 0,
        totalProcessTime: 0,
        processCount: 0
    };
    
    var connection = redis.createClient(redisConfig.port, redisConfig.host);
    
    // Enhanced Redis connection handling
    if (redisConfig.password) {
        connection.auth(redisConfig.password, function(err) {
            if (err) {
                logger.error(logSystem, logComponent, logSubCat, 
                    'Redis authentication failed: ' + err.message);
            } else {
                logger.success(logSystem, logComponent, logSubCat, 
                    'Redis authenticated successfully');
            }
        });
    }
    
    connection.on('ready', function(){
        logger.success(logSystem, logComponent, logSubCat, 
            'Share processor connected to Redis at ' + redisConfig.host + ':' + redisConfig.port);
        
        // Get initial stats from Redis
        loadInitialStats();
    });
    
    connection.on('error', function(err){
        perfStats.redisErrors++;
        logger.error(logSystem, logComponent, logSubCat, 
            'Redis error (#' + perfStats.redisErrors + '): ' + JSON.stringify(err));
    });
    
    connection.on('end', function(){
        logger.error(logSystem, logComponent, logSubCat, 
            'Redis connection lost - shares may not be recorded!');
    });
    
    connection.on('reconnecting', function(){
        logger.warning(logSystem, logComponent, logSubCat, 
            'Attempting to reconnect to Redis...');
    });
    
    // Redis version check with enhanced logging
    connection.info(function(error, response){
        if (error){
            logger.error(logSystem, logComponent, logSubCat, 
                'Redis version check failed: ' + error.message);
            return;
        }
        
        var parts = response.split('\r\n');
        var version;
        var versionString;
        var memoryUsed;
        var connectedClients;
        
        for (var i = 0; i < parts.length; i++){
            if (parts[i].indexOf(':') !== -1){
                var valParts = parts[i].split(':');
                switch(valParts[0]) {
                    case 'redis_version':
                        versionString = valParts[1];
                        version = parseFloat(versionString);
                        break;
                    case 'used_memory_human':
                        memoryUsed = valParts[1];
                        break;
                    case 'connected_clients':
                        connectedClients = valParts[1];
                        break;
                }
            }
        }
        
        if (!version){
            logger.error(logSystem, logComponent, logSubCat, 
                'Could not detect Redis version - may be incompatible');
        } else if (version < 2.6){
            logger.error(logSystem, logComponent, logSubCat, 
                'Redis version ' + versionString + ' detected - minimum required is 2.6!');
        } else {
            logger.info(logSystem, logComponent, logSubCat, 
                'Redis v' + versionString + ' - Memory: ' + memoryUsed + ', Clients: ' + connectedClients);
        }
    });
    
    // Load initial statistics from Redis
    function loadInitialStats() {
        connection.multi([
            ['hget', coin + ':stats', 'validBlocks'],
            ['hget', coin + ':stats:solo', 'validBlocks'],
            ['scard', coin + ':blocksPending'],
            ['scard', coin + ':blocksPending:solo'],
            ['scard', coin + ':activeMiners']
        ]).exec(function(err, replies) {
            if (!err && replies) {
                var poolBlocks = parseInt(replies[0]) || 0;
                var soloBlocks = parseInt(replies[1]) || 0;
                var pendingPool = parseInt(replies[2]) || 0;
                var pendingSolo = parseInt(replies[3]) || 0;
                var activeMiners = parseInt(replies[4]) || 0;
                
                logger.info(logSystem, logComponent, logSubCat, 
                    'Loaded stats - Pool blocks: ' + poolBlocks + ' (pending: ' + pendingPool + 
                    '), Solo blocks: ' + soloBlocks + ' (pending: ' + pendingSolo + 
                    '), Active miners: ' + activeMiners);
            }
        });
    }

    this.handleShare = function(isValidShare, isValidBlock, shareData) {
        var processStart = Date.now();
        var redisCommands = [];
        var dateNow = Date.now();
        
        // Get solo flag from shareData (set by poolWorker)
        var isSoloMining = shareData.isSoloMining || false;
        
        // Parse worker information
        var workerAddress = shareData.worker;
        var workerAddressParts = workerAddress.split('.');
        var minerAddress = workerAddressParts[0];
        var workerName = workerAddressParts[1] || 'default';
        
        // Track unique workers
        stats.workers.add(workerAddress);
        
        // Log share processing start
        logger.debug(logSystem, logComponent, logSubCat, 
            'Processing ' + (isSoloMining ? 'SOLO' : 'POOL') + ' share from ' + workerAddress + 
            ' - Valid: ' + isValidShare + ', Block: ' + isValidBlock + 
            ', Diff: ' + shareData.difficulty);
        
        if (isValidShare) {
            if (isSoloMining) {
                // SOLO MINING SHARES
                stats.shares.solo++;
                
                // Solo round shares
                redisCommands.push(['hincrbyfloat', coin + ':shares:roundCurrent:solo', shareData.worker, shareData.difficulty]);
                redisCommands.push(['hincrby', coin + ':stats:solo', 'validShares', 1]);
                
                // Solo worker tracking with detailed stats
                redisCommands.push(['hincrbyfloat', coin + ':workers:solo:' + workerAddress, 'shares', shareData.difficulty]);
                redisCommands.push(['hset', coin + ':workers:solo:' + workerAddress, 'lastShare', dateNow]);
                redisCommands.push(['hincrby', coin + ':workers:solo:' + workerAddress, 'validShares', 1]);
                redisCommands.push(['hset', coin + ':workers:solo:' + workerAddress, 'minerAddress', minerAddress]);
                redisCommands.push(['hset', coin + ':workers:solo:' + workerAddress, 'workerName', workerName]);
                
                // Solo hashrate tracking
                var hashrateData = [shareData.difficulty, shareData.worker, dateNow];
                redisCommands.push(['zadd', coin + ':hashrate:solo', dateNow / 1000 | 0, hashrateData.join(':')]);
                
                // Log solo share
                if (stats.shares.solo % 100 === 0) {
                    logger.info(logSystem, logComponent, logSubCat, 
                        '[SOLO Milestone] ' + stats.shares.solo + ' solo shares processed');
                }
                
            } else {
                // POOL MINING SHARES
                stats.shares.pool++;
                
                // Pool round shares
                redisCommands.push(['hincrbyfloat', coin + ':shares:roundCurrent', shareData.worker, shareData.difficulty]);
                redisCommands.push(['hincrby', coin + ':stats', 'validShares', 1]);
                
                // Pool worker tracking with detailed stats
                redisCommands.push(['hincrbyfloat', coin + ':workers:' + workerAddress, 'shares', shareData.difficulty]);
                redisCommands.push(['hset', coin + ':workers:' + workerAddress, 'lastShare', dateNow]);
                redisCommands.push(['hincrby', coin + ':workers:' + workerAddress, 'validShares', 1]);
                redisCommands.push(['hset', coin + ':workers:' + workerAddress, 'minerAddress', minerAddress]);
                redisCommands.push(['hset', coin + ':workers:' + workerAddress, 'workerName', workerName]);
                
                // Pool hashrate tracking
                var hashrateData = [shareData.difficulty, shareData.worker, dateNow];
                redisCommands.push(['zadd', coin + ':hashrate', dateNow / 1000 | 0, hashrateData.join(':')]);
                
                // Log pool share milestones
                if (stats.shares.pool % 1000 === 0) {
                    logger.info(logSystem, logComponent, logSubCat, 
                        '[POOL Milestone] ' + stats.shares.pool + ' pool shares processed');
                }
            }
            
            // Track active miners (both solo and pool)
            redisCommands.push(['sadd', coin + ':activeMiners', minerAddress]);
            redisCommands.push(['setex', coin + ':worker:' + workerAddress, 3600, dateNow]);
            
            // Track miner type
            redisCommands.push(['hset', coin + ':minerTypes', minerAddress, isSoloMining ? 'solo' : 'pool']);
            
        } else {
            // INVALID SHARES
            stats.shares.invalid++;
            
            redisCommands.push(['hincrby', coin + ':stats', 'invalidShares', 1]);
            
            // Track invalid shares per worker
            if (isSoloMining) {
                redisCommands.push(['hincrby', coin + ':stats:solo', 'invalidShares', 1]);
                redisCommands.push(['hincrby', coin + ':workers:solo:' + workerAddress, 'invalidShares', 1]);
                
                // Negative difficulty for invalid shares in hashrate calculation
                var hashrateData = [-shareData.difficulty, shareData.worker, dateNow];
                redisCommands.push(['zadd', coin + ':hashrate:solo', dateNow / 1000 | 0, hashrateData.join(':')]);
                
                logger.warning(logSystem, logComponent, logSubCat, 
                    '[SOLO Invalid] Worker ' + workerAddress + ' submitted invalid share');
            } else {
                redisCommands.push(['hincrby', coin + ':workers:' + workerAddress, 'invalidShares', 1]);
                
                // Negative difficulty for invalid shares
                var hashrateData = [-shareData.difficulty, shareData.worker, dateNow];
                redisCommands.push(['zadd', coin + ':hashrate', dateNow / 1000 | 0, hashrateData.join(':')]);
                
                logger.warning(logSystem, logComponent, logSubCat, 
                    '[POOL Invalid] Worker ' + workerAddress + ' submitted invalid share');
            }
            
            // Log high invalid share rate warning
            if (stats.shares.invalid > 10) {
                var totalShares = stats.shares.pool + stats.shares.solo + stats.shares.invalid;
                var invalidRate = (stats.shares.invalid / totalShares * 100).toFixed(2);
                if (invalidRate > 5) {
                    logger.warning(logSystem, logComponent, logSubCat, 
                        'High invalid share rate detected: ' + invalidRate + '% (' + 
                        stats.shares.invalid + '/' + totalShares + ')');
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
                txHash: shareData.txHash || shareData.blockHash
            };
            
            if (isSoloMining) {
                // SOLO BLOCK FOUND
                stats.blocks.solo++;
                
                logger.special(logSystem, logComponent, logSubCat, 
                    '★★★ SOLO BLOCK FOUND! ★★★ Height: ' + blockInfo.height + 
                    ', Worker: ' + blockInfo.worker + ', Hash: ' + blockInfo.hash);
                
                // Log to structured data for monitoring
                logger.logStructured({
                    severity: 'special',
                    system: logSystem,
                    component: logComponent,
                    text: 'SOLO BLOCK FOUND',
                    data: {
                        height: blockInfo.height,
                        hash: blockInfo.hash,
                        worker: blockInfo.worker,
                        minerAddress: minerAddress,
                        workerName: workerName,
                        timestamp: dateNow,
                        reward: blockInfo.reward
                    }
                });
                
                // Store solo block
                redisCommands.push(['sadd', coin + ':blocksPending:solo', 
                    [blockInfo.hash, blockInfo.txHash, blockInfo.height, 
                     blockInfo.worker, dateNow].join(':')]);
                
                // Store solo shares for this block height
                redisCommands.push(['hset', coin + ':shares:round' + blockInfo.height + ':solo', 
                    shareData.worker, '1']);
                
                // Also store times for compatibility
                redisCommands.push(['hset', coin + ':shares:times' + blockInfo.height, 
                    minerAddress, '1']);
                
                // Clear solo round shares for new round
                redisCommands.push(['del', coin + ':shares:roundCurrent:solo']);
                
                // Update solo block stats
                redisCommands.push(['hincrby', coin + ':stats:solo', 'validBlocks', 1]);
                redisCommands.push(['hincrby', coin + ':workers:solo:' + workerAddress, 'blocks', 1]);
                
                // Store last block info
                redisCommands.push(['hset', coin + ':lastBlock:solo', 'height', blockInfo.height]);
                redisCommands.push(['hset', coin + ':lastBlock:solo', 'worker', blockInfo.worker]);
                redisCommands.push(['hset', coin + ':lastBlock:solo', 'time', dateNow]);
                
            } else {
                // POOL BLOCK FOUND
                stats.blocks.pool++;
                
                logger.special(logSystem, logComponent, logSubCat, 
                    '★★★ POOL BLOCK FOUND! ★★★ Height: ' + blockInfo.height + 
                    ', Worker: ' + blockInfo.worker + ', Hash: ' + blockInfo.hash);
                
                // Log to structured data
                logger.logStructured({
                    severity: 'special',
                    system: logSystem,
                    component: logComponent,
                    text: 'POOL BLOCK FOUND',
                    data: {
                        height: blockInfo.height,
                        hash: blockInfo.hash,
                        worker: blockInfo.worker,
                        minerAddress: minerAddress,
                        workerName: workerName,
                        timestamp: dateNow,
                        reward: blockInfo.reward
                    }
                });
                
                // Rename current round shares to height-specific keys
                redisCommands.push(['rename', coin + ':shares:roundCurrent', 
                    coin + ':shares:round' + blockInfo.height]);
                redisCommands.push(['rename', coin + ':shares:timesCurrent', 
                    coin + ':shares:times' + blockInfo.height]);
                
                // Store pool block
                redisCommands.push(['sadd', coin + ':blocksPending', 
                    [blockInfo.hash, blockInfo.txHash, blockInfo.height, 
                     blockInfo.worker, dateNow].join(':')]);
                
                // Update pool block stats
                redisCommands.push(['hincrby', coin + ':workers:' + workerAddress, 'blocks', 1]);
                
                // Store last block info
                redisCommands.push(['hset', coin + ':lastBlock:pool', 'height', blockInfo.height]);
                redisCommands.push(['hset', coin + ':lastBlock:pool', 'worker', blockInfo.worker]);
                redisCommands.push(['hset', coin + ':lastBlock:pool', 'time', dateNow]);
            }
            
            // Update general block stats
            redisCommands.push(['hincrby', coin + ':stats', 'validBlocks', 1]);
            stats.lastBlock = blockInfo;
            
            // Calculate time since last block
            if (stats.lastBlockTime) {
                var timeSince = (dateNow - stats.lastBlockTime) / 1000;
                logger.info(logSystem, logComponent, logSubCat, 
                    'Time since last block: ' + formatDuration(timeSince * 1000));
            }
            stats.lastBlockTime = dateNow;
        }

        // Execute all Redis commands
        perfStats.redisWrites += redisCommands.length;
        
        connection.multi(redisCommands).exec(function(err, replies){
            var processTime = Date.now() - processStart;
            perfStats.totalProcessTime += processTime;
            perfStats.processCount++;
            perfStats.avgProcessTime = perfStats.totalProcessTime / perfStats.processCount;
            
            if (err) {
                perfStats.redisErrors++;
                logger.error(logSystem, logComponent, logSubCat, 
                    'Redis multi-exec error (#' + perfStats.redisErrors + '): ' + JSON.stringify(err) + 
                    ' | Commands: ' + redisCommands.length + ', Process time: ' + processTime + 'ms');
            } else {
                // Log slow operations
                if (processTime > 100) {
                    logger.warning(logSystem, logComponent, logSubCat, 
                        'Slow share processing detected: ' + processTime + 'ms for ' + 
                        redisCommands.length + ' Redis commands');
                }
                
                // Log successful block storage
                if (isValidBlock) {
                    logger.success(logSystem, logComponent, logSubCat, 
                        (isSoloMining ? 'SOLO' : 'POOL') + ' block ' + shareData.height + 
                        ' stored successfully (' + redisCommands.length + ' commands, ' + 
                        processTime + 'ms)');
                }
            }
        });
    };
    
    // Helper function to format duration
    function formatDuration(ms) {
        var seconds = Math.floor(ms / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        var days = Math.floor(hours / 24);
        
        if (days > 0) return days + 'd ' + (hours % 24) + 'h ' + (minutes % 60) + 'm';
        if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm ' + (seconds % 60) + 's';
        if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
        return seconds + 's';
    }
    
    // Log statistics periodically
    setInterval(function() {
        var uptime = Date.now() - stats.startTime;
        var totalShares = stats.shares.pool + stats.shares.solo;
        
        logger.info(logSystem, logComponent, logSubCat, 
            'Share Processor Stats - Uptime: ' + formatDuration(uptime) + 
            ', Pool shares: ' + stats.shares.pool + 
            ', Solo shares: ' + stats.shares.solo + 
            ', Invalid: ' + stats.shares.invalid + 
            ', Pool blocks: ' + stats.blocks.pool + 
            ', Solo blocks: ' + stats.blocks.solo + 
            ', Workers: ' + stats.workers.size + 
            ', Redis writes: ' + perfStats.redisWrites + 
            ', Redis errors: ' + perfStats.redisErrors + 
            ', Avg process time: ' + perfStats.avgProcessTime.toFixed(2) + 'ms');
            
        // Check Redis connection health
        connection.ping(function(err) {
            if (err) {
                logger.error(logSystem, logComponent, logSubCat, 
                    'Redis health check failed: ' + err.message);
            }
        });
    }, 300000); // Every 5 minutes
};