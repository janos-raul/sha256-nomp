const redis = require('redis');
const Stratum = require('stratum-pool');
const fs = require('fs');
const path = require('path');

// Import the logger if running as part of the pool
let logger;
try {
    const PoolLogger = require('./libs/logUtil.js');
    logger = new PoolLogger({
        logLevel: 'debug',
        logColors: true,
        logDir: 'logs',
        logToConsole: true,
        logToFile: true
    });
} catch(e) {
    // Fallback to console logging if logger not available
    logger = {
        debug: (sys, comp, msg) => console.log(`[DEBUG] [${sys}] [${comp}] ${msg}`),
        info: (sys, comp, msg) => console.log(`[INFO] [${sys}] [${comp}] ${msg}`),
        warning: (sys, comp, msg) => console.log(`[WARNING] [${sys}] [${comp}] ${msg}`),
        error: (sys, comp, msg) => console.error(`[ERROR] [${sys}] [${comp}] ${msg}`),
        special: (sys, comp, msg) => console.log(`[SPECIAL] [${sys}] [${comp}] ${msg}`)
    };
}

const logSystem = 'BlockConfirm';

// Pool configurations
const poolConfigs = {
    bitcoin: {
        daemon: {
            host: "192.168.188.2",
            port: 50010,
            user: "",
            password: ""
        },
        minConfirmations: 101
    },
	bitcoinii: {
        daemon: {
            host: '192.168.188.2',
            port: 18388,
            user: '',
            password: ''
        }
    },
    bitcoinsilver: {
        daemon: {
            host: '192.168.188.2',
            port: 10013,
            user: '',
            password: ''
        },
        minConfirmations: 201
    },
    mytherra: {
        daemon: {
            host: '192.168.188.2',
            port: 24013,
            user: '',
            password: ''
        },
        minConfirmations: 101
    }
};

// Statistics tracking
const stats = {
    startTime: Date.now(),
    coins: {},
    totalBlocks: 0,
    poolBlocks: 0,
    soloBlocks: 0,
    confirmedBlocks: 0,
    orphanedBlocks: 0,
    errors: 0
};

// Create Redis client with error handling
const client = redis.createClient();

client.on('ready', function() {
    logger.info(logSystem, 'Redis', 'Connected to Redis successfully');
});

client.on('error', function(err) {
    logger.error(logSystem, 'Redis', 'Redis error: ' + err.message);
    stats.errors++;
});

function updateConfirmations(coin, callback) {
    const config = poolConfigs[coin];
    if (!config) {
        logger.error(logSystem, coin, 'No configuration found for coin');
        return callback();
    }
    
    // Initialize coin stats
    if (!stats.coins[coin]) {
        stats.coins[coin] = {
            pool: { pending: 0, confirmed: 0, orphaned: 0 },
            solo: { pending: 0, confirmed: 0, orphaned: 0 }
        };
    }
    
    logger.info(logSystem, coin, 'Starting block confirmation check...');
    
    // Create daemon interface with logging
    const daemon = new Stratum.daemon.interface([config.daemon], function(severity, message){
        logger[severity](logSystem, coin, message);
    });
    
    let pendingChecks = 0;
    let completedChecks = 0;
    
    const checkComplete = () => {
        completedChecks++;
        if (completedChecks >= pendingChecks) {
            logger.info(logSystem, coin, 'Confirmation check complete');
            callback();
        }
    };
    
    // Get pending pool blocks
    client.smembers(`${coin}:blocksPending`, (err, blocks) => {
        if (err) {
            logger.error(logSystem, coin, 'Error fetching pool blocks: ' + err.message);
            stats.errors++;
            return checkComplete();
        }
        
        if (blocks && blocks.length > 0) {
            logger.info(logSystem, coin, 'Found ' + blocks.length + ' pending pool blocks');
            stats.poolBlocks += blocks.length;
            stats.coins[coin].pool.pending = blocks.length;
            
            blocks.forEach(blockData => {
                pendingChecks++;
                const parts = blockData.split(':');
                const blockHash = parts[0];
                const txHash = parts[1];
                const blockHeight = parseInt(parts[2]);
                const minedBy = parts[3];
                const time = parts[4];
                
                // Get block info from daemon
                daemon.cmd('getblock', [blockHash], function(result){
                    if (result[0].error) {
                        if (result[0].error.code === -5) {
                            logger.warning(logSystem, coin, 
                                'Pool block ' + blockHeight + ' not found (possibly orphaned)');
                            stats.orphanedBlocks++;
                            stats.coins[coin].pool.orphaned++;
                        } else {
                            logger.error(logSystem, coin, 
                                'Error checking pool block ' + blockHeight + ': ' + JSON.stringify(result[0].error));
                            stats.errors++;
                        }
                    } else if (result[0].response) {
                        const confirmations = result[0].response.confirmations || 0;
                        
                        // Update confirmations in Redis
                        client.hset(`${coin}:blocksPendingConfirms`, blockHash, confirmations, (err) => {
                            if (err) {
                                logger.error(logSystem, coin, 'Error updating confirmations: ' + err.message);
                            }
                        });
                        
                        // Log status based on confirmations
                        if (confirmations >= config.minConfirmations) {
                            logger.special(logSystem, coin, 
                                'POOL block ' + blockHeight + ' CONFIRMED! ' + 
                                confirmations + '/' + config.minConfirmations + ' confirmations');
                            stats.confirmedBlocks++;
                            stats.coins[coin].pool.confirmed++;
                        } else if (confirmations === -1) {
                            logger.warning(logSystem, coin, 
                                'POOL block ' + blockHeight + ' ORPHANED!');
                            stats.orphanedBlocks++;
                            stats.coins[coin].pool.orphaned++;
                        } else {
                            logger.info(logSystem, coin, 
                                'POOL block ' + blockHeight + ': ' + 
                                confirmations + '/' + config.minConfirmations + ' confirmations');
                        }
                    }
                    checkComplete();
                });
            });
        } else {
            logger.debug(logSystem, coin, 'No pending pool blocks');
        }
        
        if (pendingChecks === 0) checkComplete();
    });
    
    // Get pending solo blocks
    client.smembers(`${coin}:blocksPending:solo`, (err, blocks) => {
        if (err) {
            logger.error(logSystem, coin, 'Error fetching solo blocks: ' + err.message);
            stats.errors++;
            return checkComplete();
        }
        
        if (blocks && blocks.length > 0) {
            logger.info(logSystem, coin, 'Found ' + blocks.length + ' pending SOLO blocks');
            stats.soloBlocks += blocks.length;
            stats.coins[coin].solo.pending = blocks.length;
            
            blocks.forEach(blockData => {
                pendingChecks++;
                const parts = blockData.split(':');
                const blockHash = parts[0];
                const txHash = parts[1];
                const blockHeight = parseInt(parts[2]);
                const minedBy = parts[3];
                const time = parts[4];
                
                daemon.cmd('getblock', [blockHash], function(result){
                    if (result[0].error) {
                        if (result[0].error.code === -5) {
                            logger.warning(logSystem, coin, 
                                'SOLO block ' + blockHeight + ' by ' + minedBy + ' not found (possibly orphaned)');
                            stats.orphanedBlocks++;
                            stats.coins[coin].solo.orphaned++;
                        } else {
                            logger.error(logSystem, coin, 
                                'Error checking SOLO block ' + blockHeight + ': ' + JSON.stringify(result[0].error));
                            stats.errors++;
                        }
                    } else if (result[0].response) {
                        const confirmations = result[0].response.confirmations || 0;
                        
                        // Update confirmations in Redis
                        client.hset(`${coin}:blocksPendingConfirms`, blockHash, confirmations, (err) => {
                            if (err) {
                                logger.error(logSystem, coin, 'Error updating SOLO confirmations: ' + err.message);
                            }
                        });
                        
                        // Log status based on confirmations
                        if (confirmations >= config.minConfirmations) {
                            logger.special(logSystem, coin, 
                                '★ SOLO block ' + blockHeight + ' by ' + minedBy + ' CONFIRMED! ' + 
                                confirmations + '/' + config.minConfirmations + ' confirmations');
                            stats.confirmedBlocks++;
                            stats.coins[coin].solo.confirmed++;
                        } else if (confirmations === -1) {
                            logger.warning(logSystem, coin, 
                                'SOLO block ' + blockHeight + ' by ' + minedBy + ' ORPHANED!');
                            stats.orphanedBlocks++;
                            stats.coins[coin].solo.orphaned++;
                        } else {
                            logger.info(logSystem, coin, 
                                'SOLO block ' + blockHeight + ' by ' + minedBy + ': ' + 
                                confirmations + '/' + config.minConfirmations + ' confirmations');
                        }
                    }
                    checkComplete();
                });
            });
        } else {
            logger.debug(logSystem, coin, 'No pending solo blocks');
        }
        
        if (pendingChecks === 0) checkComplete();
    });
}

// Process all coins
logger.special(logSystem, 'Init', '=== Block Confirmation Tracker Started ===');
logger.info(logSystem, 'Init', 'Checking confirmations for: ' + Object.keys(poolConfigs).join(', '));

let processedCoins = 0;
const totalCoins = Object.keys(poolConfigs).length;

Object.keys(poolConfigs).forEach(coin => {
    updateConfirmations(coin, () => {
        processedCoins++;
        
        if (processedCoins === totalCoins) {
            // All coins processed, show summary
            const runtime = Date.now() - stats.startTime;
            
            logger.special(logSystem, 'Summary', '=== Confirmation Check Complete ===');
            logger.info(logSystem, 'Summary', 'Runtime: ' + runtime + 'ms');
            logger.info(logSystem, 'Summary', 'Pool blocks: ' + stats.poolBlocks + 
                ' (Confirmed: ' + Object.keys(stats.coins).reduce((sum, c) => sum + stats.coins[c].pool.confirmed, 0) + ')');
            logger.info(logSystem, 'Summary', 'Solo blocks: ' + stats.soloBlocks + 
                ' (Confirmed: ' + Object.keys(stats.coins).reduce((sum, c) => sum + stats.coins[c].solo.confirmed, 0) + ')');
            
            if (stats.orphanedBlocks > 0) {
                logger.warning(logSystem, 'Summary', 'Orphaned blocks detected: ' + stats.orphanedBlocks);
            }
            
            if (stats.errors > 0) {
                logger.error(logSystem, 'Summary', 'Errors encountered: ' + stats.errors);
            }
            
            // Per-coin summary
            Object.keys(stats.coins).forEach(coin => {
                const coinStats = stats.coins[coin];
                if (coinStats.pool.pending > 0 || coinStats.solo.pending > 0) {
                    logger.info(logSystem, coin, 
                        'Pool: ' + coinStats.pool.pending + ' pending, ' + 
                        coinStats.pool.confirmed + ' confirmed, ' + 
                        coinStats.pool.orphaned + ' orphaned | ' +
                        'Solo: ' + coinStats.solo.pending + ' pending, ' + 
                        coinStats.solo.confirmed + ' confirmed, ' + 
                        coinStats.solo.orphaned + ' orphaned');
                }
            });
            
            // Close connections and exit
            setTimeout(() => {
                logger.info(logSystem, 'Shutdown', 'Closing connections...');
                client.quit(() => {
                    logger.info(logSystem, 'Shutdown', 'Redis connection closed');
                    process.exit(stats.errors > 0 ? 1 : 0);
                });
            }, 1000);
        }
    });
});