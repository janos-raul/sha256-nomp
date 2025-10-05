var https = require('https');
var fs = require('fs');
var path = require('path');

var async = require('async');
var watch = require('node-watch');
var redis = require('redis');

var dot = require('dot');
var express = require('express');
var compress = require('compression');

var Stratum = require('stratum-pool');
var util = require('stratum-pool/lib/util.js');

var api = require('./api.js');


module.exports = function (logger) {

    dot.templateSettings.strip = false;

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var websiteConfig = portalConfig.website;

    var portalApi = new api(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;

    var logSystem = 'Website';

	var requestStats = {
		total: 0,
		api: 0,
		pages: 0,
		errors: 0,
		startTime: Date.now()
	};
	logger.info(logSystem, 'Init', 'Starting website module...');
	
    var pageFiles = {
        'index.html': 'index',
        'home.html': '',
        'getting_started.html': 'getting_started',
        'stats.html': 'stats',
        'tbs.html': 'tbs',
        'workers.html': 'workers',
        'api.html': 'api',
        'admin.html': 'admin',
        'mining_key.html': 'mining_key',
        'miner_stats.html': 'miner_stats',
        'payments.html': 'payments'
    };

    var pageTemplates = {};

    var pageProcessed = {};
    var indexesProcessed = {};

    var keyScriptTemplate = '';
    var keyScriptProcessed = '';
	
	function getReadableDifficultyString(difficulty) {
		  if (difficulty >= 1e24) return (difficulty / 1e24).toFixed(2) + ' Y';
		  if (difficulty >= 1e21) return (difficulty / 1e21).toFixed(2) + ' Z';
		  if (difficulty >= 1e18) return (difficulty / 1e18).toFixed(2) + ' E';
		  if (difficulty >= 1e15) return (difficulty / 1e15).toFixed(2) + ' P';
		  if (difficulty >= 1e12) return (difficulty / 1e12).toFixed(2) + ' T';
		  if (difficulty >= 1e9)  return (difficulty / 1e9).toFixed(2) + ' G';
		  if (difficulty >= 1e6)  return (difficulty / 1e6).toFixed(2) + ' M';
		  if (difficulty >= 1e3)  return (difficulty / 1e3).toFixed(2) + ' k';
	return difficulty.toFixed(2);
	}

    var processTemplates = function () {
		
		var startTemplateProcess = Date.now();

        for (var pageName in pageTemplates) {
            if (pageName === 'index') continue;
            pageProcessed[pageName] = pageTemplates[pageName]({
                poolsConfigs: poolConfigs,
                stats: portalStats.stats,
                portalConfig: portalConfig,
				getReadableDifficultyString: getReadableDifficultyString
            });
            indexesProcessed[pageName] = pageTemplates.index({
                page: pageProcessed[pageName],
                selected: pageName,
                stats: portalStats.stats,
                poolConfigs: poolConfigs,
                portalConfig: portalConfig,
				getReadableDifficultyString: getReadableDifficultyString
            });
        }

    var processTime = Date.now() - startTemplateProcess;
    if (processTime > 100) {
        logger.warning(logSystem, 'Templates', 'Slow template processing: ' + processTime + 'ms');
    }
    logger.debug(logSystem, 'Templates', 'Website templates updated (' + processTime + 'ms)');
    };



    var readPageFiles = function (files) {
        async.each(files, function (fileName, callback) {
            var filePath = 'website/' + (fileName === 'index.html' ? '' : 'pages/') + fileName;
            fs.readFile(filePath, 'utf8', function (err, data) {
                if (err) {
                    logger.error(logSystem, 'Files', 'Error reading file: ' + filePath + ' - ' + err);
                    return callback(err);
                }
				logger.debug(logSystem, 'Files', 'Loaded template: ' + fileName);
                var pTemp = dot.template(data);
                pageTemplates[pageFiles[fileName]] = pTemp;
                callback();
            });
        }, function (err) {
            if (err) {
                logger.error(logSystem, 'Files', 'Error reading template files: ' + JSON.stringify(err));
                return;
            }
			logger.info(logSystem, 'Files', 'All template files loaded successfully');
            processTemplates();
        });
    };


    // if an html file was changed reload it
    /* requires node-watch 0.5.0 or newer */
    watch(['./website', './website/pages'], function (evt, filename) {
        var basename;
        // support older versions of node-watch automatically
        if (!filename && evt)
            basename = path.basename(evt);
        else
            basename = path.basename(filename);

        if (basename in pageFiles) {
            readPageFiles([basename]);
            logger.special(logSystem, 'HotReload', 'Reloaded template: ' + basename);
        }
    });

    portalStats.getGlobalStats(function () {
        readPageFiles(Object.keys(pageFiles));
    });

var buildUpdatedWebsite = function () {
	var updateStart = Date.now();
    portalStats.getGlobalStats(function () {
        processTemplates();

        var statData = 'data: ' + JSON.stringify(portalStats.stats) + '\n\n';
		var activeConnections = 0;
        var failedConnections = 0;
        
        for (var uid in portalApi.liveStatConnections) {
            var res = portalApi.liveStatConnections[uid];
            try {
                res.write(statData);
                // Only flush if the method exists
                if (typeof res.flush === 'function') {
                    res.flush();
                }
				activeConnections++;
            } catch(e) {
                logger.error(logSystem, 'LiveStats', 'Error writing to connection ' + uid + ': ' + e.message);
                delete portalApi.liveStatConnections[uid];
				failedConnections++;
            }
        }
		    var updateTime = Date.now() - updateStart;
				if (activeConnections > 0 || failedConnections > 0) {
					logger.debug(logSystem, 'LiveStats', 
						'Stats broadcast - Active: ' + activeConnections + 
						', Failed: ' + failedConnections + 
						', Time: ' + updateTime + 'ms');
				}
    });
};

    setInterval(buildUpdatedWebsite, websiteConfig.stats.updateInterval * 1000);

    var buildKeyScriptPage = function () {
        async.waterfall([
            function (callback) {
                var client = redis.createClient(portalConfig.redis.port, portalConfig.redis.host);
                if (portalConfig.redis.password) {
                    client.auth(portalConfig.redis.password);
                }
                client.hgetall('coinVersionBytes', function (err, coinBytes) {
                    if (err) {
                        client.quit();
                        return callback('Failed grabbing coin version bytes from redis ' + JSON.stringify(err));
                    }
                    callback(null, client, coinBytes || {});
                });
            },
            function (client, coinBytes, callback) {
                var enabledCoins = Object.keys(poolConfigs).map(function (c) { return c.toLowerCase() });
                var missingCoins = [];
                enabledCoins.forEach(function (c) {
                    if (!(c in coinBytes))
                        missingCoins.push(c);
                });
                callback(null, client, coinBytes, missingCoins);
            },
            function (client, coinBytes, missingCoins, callback) {
                var coinsForRedis = {};
                async.each(missingCoins, function (c, cback) {
                    var coinInfo = (function () {
                        for (var pName in poolConfigs) {
                            if (pName.toLowerCase() === c)
                                return {
                                    daemon: poolConfigs[pName].paymentProcessing.daemon,
                                    address: poolConfigs[pName].address
                                }
                        }
                    })();
                    var daemon = new Stratum.daemon.interface([coinInfo.daemon], function (severity, message) {
                        logger[severity](logSystem, c, message);
                    });
                    daemon.cmd('dumpprivkey', [coinInfo.address], function (result) {
                        if (result[0].error) {
                                    logger.error(logSystem, 'KeyScript', 
															'Failed to get private key for ' + c + ' address ' + coinInfo.address + 
															' - ' + JSON.stringify(result[0].error));
                            cback();
                            return;
                        }
						logger.debug(logSystem, 'KeyScript', 'Retrieved key for coin: ' + c);

                        var vBytePub = util.getVersionByte(coinInfo.address)[0];
                        var vBytePriv = util.getVersionByte(result[0].response)[0];

                        coinBytes[c] = vBytePub.toString() + ',' + vBytePriv.toString();
                        coinsForRedis[c] = coinBytes[c];
                        cback();
                    });
                }, function (err) {
                    callback(null, client, coinBytes, coinsForRedis);
                });
            },
            function (client, coinBytes, coinsForRedis, callback) {
                if (Object.keys(coinsForRedis).length > 0) {
                    client.hmset('coinVersionBytes', coinsForRedis, function (err) {
                        if (err)
                            logger.error(logSystem, 'Init', 'Failed inserting coin byte version into redis ' + JSON.stringify(err));
                        client.quit();
                    });
                }
                else {
                    client.quit();
                }
                callback(null, coinBytes);
            }
        ], function (err, coinBytes) {
            if (err) {
                logger.error(logSystem, 'Init', err);
                return;
            }
            try {
                keyScriptTemplate = dot.template(fs.readFileSync('website/key.html', { encoding: 'utf8' }));
                keyScriptProcessed = keyScriptTemplate({ coins: coinBytes });
            }
            catch (e) {
                logger.error(logSystem, 'Init', 'Failed to read key.html file');
            }
        });

    };

    var getPage = function (pageId) {
        if (pageId in pageProcessed) {
            var requestedPage = pageProcessed[pageId];
            return requestedPage;
        }
    };

	var minerpage = function (req, res, next) {
		var address = req.params.address || null;
		    requestStats.total++;
			logger.info(logSystem, 'MinerPage', 'Miner stats requested for: ' + (address || 'unknown'));
		if (address != null) {
			address = address.split(".")[0];
			var fetchStart = Date.now();
			
			portalStats.getBalanceByAddress(address, function (balanceData) {
				            var fetchTime = Date.now() - fetchStart;
								logger.debug(logSystem, 'MinerPage', 
									'Retrieved balance for ' + address + ' in ' + fetchTime + 'ms');
				// Set the address in stats so it's available in the template
				portalStats.stats.address = address;
				processTemplates();
				res.header('Content-Type', 'text/html');
				res.end(indexesProcessed['miner_stats']);
			});
		}
		else
			next();
	};

    var payout = function (req, res, next) {
        var address = req.params.address || null;
        if (address != null) {
            portalStats.getPayout(address, function (data) {
                res.write(data.toString());
                res.end();
            });
        }
        else
            next();
    };

    var shares = function (req, res, next) {
        portalStats.getCoins(function () {
            processTemplates();
            res.end(indexesProcessed['user_shares']);

        });
    };

    var usershares = function (req, res, next) {
        var coin = req.params.coin || null;
        if (coin != null) {
            portalStats.getCoinTotals(coin, null, function () {
                processTemplates();
                res.end(indexesProcessed['user_shares']);
            });
        }
        else
            next();
    };

var route = function (req, res, next) {

        var pageId = req.params.page || '';
        requestStats.total++;
        requestStats.pages++;
        var acceptLanguage = req.headers['accept-language'];
        let language = 'en';

        if (acceptLanguage) {
            const supportedLanguages = [
                'en', 'en-US', 'ja', 'zh', 'zh-TW', 'zh-HK', 'fr', 'es', 'de', 'ro', 'ru',
                'hi', 'ar', 'pt', 'it', 'tl', 'id', 'ms', 'ko', 'vi', 'tr', 'hu'
            ];
            const languages = acceptLanguage.split(',').map(lang => lang.split(';')[0].trim());

            for (let lang of languages) {
                if (supportedLanguages.includes(lang)) {
                    language = lang;
                    break;
                }
            }
        }

        // FIX: Check if we have a processed page for this route
        // If pageId is empty (home page), use the home content
        var pageToServe = pageId || 'home';
        
        // Check if this is the index/home page request
        if (pageId === '' || pageId === 'home') {
            // Serve the index with home content
            logger.debug(logSystem, 'Route', 
                'Page served: home [' + language + ']');
            res.header('Content-Type', 'text/html');
            
            // Use the home page content in the index template
            var homeIndex = pageTemplates.index({
                page: pageProcessed['home'] || pageProcessed[''],
                selected: 'home',
                stats: portalStats.stats,
                poolConfigs: poolConfigs,
                portalConfig: portalConfig,
                getReadableDifficultyString: getReadableDifficultyString
            });
            
            let pageContent = homeIndex.replace(/<html lang=".*?">/, `<html lang="${language}">`);
            res.end(pageContent);
        }
        else if (pageId in pageProcessed) {
            // Serve the index with the requested page content
            logger.debug(logSystem, 'Route', 
                'Page served: ' + pageId + ' [' + language + ']');
            res.header('Content-Type', 'text/html');
            
            // Generate the index with the correct page content
            var pageIndex = pageTemplates.index({
                page: pageProcessed[pageId],
                selected: pageId,
                stats: portalStats.stats,
                poolConfigs: poolConfigs,
                portalConfig: portalConfig,
                getReadableDifficultyString: getReadableDifficultyString
            });
            
            let pageContent = pageIndex.replace(/<html lang=".*?">/, `<html lang="${language}">`);
            res.end(pageContent);
        }
        else {
            logger.debug(logSystem, 'Route', 'Page not found: ' + pageId);
            next();
        }
    };



    var app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

app.get('/get_page', function (req, res, next) {
    var pageId = req.query.id;
    var address = req.query.address;
    
    // Special handling for workers page with address
    if (pageId === 'workers' && address) {
        // Log the request
        logger.debug(logSystem, 'GetPage', 'Miner stats requested via get_page for: ' + address);
        
        // Get balance data for the address
        portalStats.getBalanceByAddress(address.split(".")[0], function (balanceData) {
            // Set the address in stats so it's available in the template
            portalStats.stats.address = address;
            
            // Process the miner_stats template with the address
            var minerStatsPage = pageTemplates['miner_stats']({
                poolsConfigs: poolConfigs,
                stats: portalStats.stats,
                portalConfig: portalConfig,
                getReadableDifficultyString: getReadableDifficultyString
            });
            
            res.end(minerStatsPage);
        });
        return;
    }
    
    // Regular page handling
    var requestedPage = getPage(pageId);
    if (requestedPage) {
        res.end(requestedPage);
        return;
    }
    next();
});
	
	app.get('/api/:method', function (req, res, next) {
		    requestStats.total++;
			requestStats.api++;
			var apiStart = Date.now();
			var method = req.params.method;
			
			logger.debug(logSystem, 'API', 'API request: ' + method);
			
			// Wrap the original handler:
			var originalEnd = res.end;
			res.end = function() {
				var apiTime = Date.now() - apiStart;
				logger.debug(logSystem, 'API', 
					'API response: ' + method + ' (' + apiTime + 'ms)');
				originalEnd.apply(res, arguments);
			};
        portalApi.handleApiRequest(req, res, next);
    });
	
    app.post('/api/admin/:method', function (req, res, next) {
		var method = req.params.method;
		logger.warning(logSystem, 'Admin', 'Admin API request: ' + method);
		
		if (portalConfig.website && portalConfig.website.adminCenter && portalConfig.website.adminCenter.enabled) {
			if (portalConfig.website.adminCenter.password === req.body.password) {
				logger.info(logSystem, 'Admin', 'Admin authenticated for: ' + method);
				portalApi.handleAdminApiRequest(req, res, next);
			} else {
				logger.warning(logSystem, 'Admin', 'Failed admin authentication for: ' + method);
				res.status(401).json({ error: 'Incorrect Password' });
			}
		}
        else
            next();

    });
	
	app.use(compress());
    app.get('/stats/shares/:coin', usershares);
    app.get('/stats/shares', shares);
    app.get('/payout/:address', payout);
    app.get('/workers/:address', minerpage);
    app.get('/:page', route);
    app.get('/', route);

    app.use('/static', express.static('website/static'));

    app.use(function (err, req, res, next) {
		requestStats.errors++;
		logger.error(logSystem, 'Server', 'Express error: ' + err.stack);
        res.status(500).send('Something broke!');
    });

    try {
        if (portalConfig.website.tlsOptions && portalConfig.website.tlsOptions.enabled === true) {
            var TLSoptions = {
                key: fs.readFileSync(portalConfig.website.tlsOptions.key),
                cert: fs.readFileSync(portalConfig.website.tlsOptions.cert)
            };
			logger.info(logSystem, 'Server', 'Starting TLS server...');
            https.createServer(TLSoptions, app).listen(portalConfig.website.port, portalConfig.website.host, function () {
                logger.success(logSystem, 'Server', 'TLS Website started on https://' + portalConfig.website.host + ':' + portalConfig.website.port);
            });
        } else {
			logger.info(logSystem, 'Server', 'Starting HTTP server...');
            app.listen(portalConfig.website.port, portalConfig.website.host, function () {
                logger.success(logSystem, 'Server', 'Website started on http://' + portalConfig.website.host + ':' + portalConfig.website.port);
            });
        }
    }
    catch (e) {
        console.log(e)
		logger.error(logSystem, 'Server', 'Failed to start website on ' + 
        portalConfig.website.host + ':' + portalConfig.website.port + 
        ' - Error: ' + e.message);
    }
	
	setInterval(function() {
		var uptime = Date.now() - requestStats.startTime;
		if (requestStats.total > 0) {
			logger.info(logSystem, 'Stats', 
				'Request stats - Total: ' + requestStats.total + 
				', Pages: ' + requestStats.pages + 
				', API: ' + requestStats.api + 
				', Errors: ' + requestStats.errors + 
				', Uptime: ' + Math.floor(uptime / 1000 / 60) + ' min');
		}
	}, 300000); // Every 5 minutes

};
