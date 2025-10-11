var https = require('https');
var fs = require('fs');
var path = require('path');

var async = require('async');
var watch = require('node-watch');
var redis = require('redis');

var dot = require('dot');
var express = require('express');
var compress = require('compression');
var helmet = require('helmet');
var rateLimit = require('express-rate-limit');

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

    // Input validation helper functions
    var validateAddress = function(address) {
        if (!address) return false;
        // Allow alphanumeric characters, dots, and dashes (typical crypto address format)
        var addressRegex = /^[a-zA-Z0-9.-]+$/;
        // Limit length to prevent DoS
        if (address.length > 100) return false;
        return addressRegex.test(address);
    };

    var validatePageId = function(pageId) {
        if (!pageId) return true; // Empty is OK (home page)
        // Only allow alphanumeric and underscores
        var pageIdRegex = /^[a-zA-Z0-9_]+$/;
        // Limit length
        if (pageId.length > 50) return false;
        return pageIdRegex.test(pageId);
    };

    var validateCoinName = function(coin) {
        if (!coin) return false;
        // Only allow alphanumeric characters
        var coinRegex = /^[a-zA-Z0-9]+$/;
        // Limit length
        if (coin.length > 20) return false;
        return coinRegex.test(coin);
    };

    // Get real client IP address (handles proxies, WSL, etc.)
    var getRealIP = function(req) {
        // Check various headers in order of reliability
        var cfIP = req.headers['cf-connecting-ip'];  // Cloudflare
        var realIP = req.headers['x-real-ip'];        // Nginx/Apache
        var forwardedFor = req.headers['x-forwarded-for'];  // Standard proxy

        // X-Forwarded-For can be a comma-separated list, take the first (original client)
        if (forwardedFor) {
            return forwardedFor.split(',')[0].trim();
        }

        // Use Cloudflare IP if available
        if (cfIP) {
            return cfIP;
        }

        // Use X-Real-IP if available
        if (realIP) {
            return realIP;
        }

        // Fallback to Express default
        return req.ip || req.connection.remoteAddress || 'unknown';
    };

	var minerpage = function (req, res, next) {
		var address = req.params.address || null;
		    requestStats.total++;
			logger.info(logSystem, 'MinerPage', 'Miner stats requested for: ' + (address || 'unknown'));

		if (address != null) {
			// Validate address before processing
			if (!validateAddress(address)) {
				logger.warning(logSystem, 'MinerPage', 'Invalid address format from IP: ' + getRealIP(req) + ' - Address: ' + address);
				requestStats.errors++;
				res.status(400).json({ error: 'Invalid address format' });
				return;
			}

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
            // Validate address before processing
            if (!validateAddress(address)) {
                logger.warning(logSystem, 'Payout', 'Invalid address format from IP: ' + getRealIP(req) + ' - Address: ' + address);
                requestStats.errors++;
                res.status(400).json({ error: 'Invalid address format' });
                return;
            }

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
            // Validate coin name before processing
            if (!validateCoinName(coin)) {
                logger.warning(logSystem, 'UserShares', 'Invalid coin name from IP: ' + getRealIP(req) + ' - Coin: ' + coin);
                requestStats.errors++;
                res.status(400).json({ error: 'Invalid coin name format' });
                return;
            }

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

        // Validate pageId before processing
        if (!validatePageId(pageId)) {
            logger.warning(logSystem, 'Route', 'Invalid page ID from IP: ' + getRealIP(req) + ' - PageID: ' + pageId);
            requestStats.errors++;
            res.status(400).json({ error: 'Invalid page identifier' });
            return;
        }

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

    // Security middleware configuration
    // Helmet helps protect from common web vulnerabilities
    app.use(helmet({
        contentSecurityPolicy: false, // Disable CSP for now to avoid breaking existing functionality
        crossOriginEmbedderPolicy: false
    }));

    // Rate limiting configuration
    const generalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Limit each IP to 100 requests per windowMs
        message: 'Too many requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
        handler: function(req, res) {
            requestStats.errors++;
            logger.warning(logSystem, 'RateLimit', 'Rate limit exceeded for IP: ' + getRealIP(req));
            res.status(429).json({ error: 'Too many requests, please try again later.' });
        }
    });

    const apiLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 30, // Limit each IP to 30 API requests per minute
        message: 'Too many API requests, please slow down.',
        standardHeaders: true,
        legacyHeaders: false,
        handler: function(req, res) {
            requestStats.errors++;
            logger.warning(logSystem, 'RateLimit', 'API rate limit exceeded for IP: ' + getRealIP(req));
            res.status(429).json({ error: 'Too many API requests, please try again later.' });
        }
    });

    const adminLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // Limit admin attempts to 5 per 15 minutes
        message: 'Too many admin requests, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
        handler: function(req, res) {
            requestStats.errors++;
            logger.warning(logSystem, 'RateLimit', 'Admin rate limit exceeded for IP: ' + getRealIP(req));
            res.status(429).json({ error: 'Too many admin authentication attempts.' });
        }
    });

    // Apply general rate limiter to all routes
    app.use(generalLimiter);

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

app.get('/get_page', function (req, res, next) {
    var pageId = req.query.id;
    var address = req.query.address;

    // Validate pageId
    if (pageId && !validatePageId(pageId)) {
        logger.warning(logSystem, 'GetPage', 'Invalid page ID from IP: ' + getRealIP(req) + ' - PageID: ' + pageId);
        requestStats.errors++;
        res.status(400).json({ error: 'Invalid page identifier' });
        return;
    }

    // Special handling for workers page with address
    if (pageId === 'workers' && address) {
        // Validate address
        if (!validateAddress(address)) {
            logger.warning(logSystem, 'GetPage', 'Invalid address format from IP: ' + getRealIP(req) + ' - Address: ' + address);
            requestStats.errors++;
            res.status(400).json({ error: 'Invalid address format' });
            return;
        }

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
	
	app.get('/api/:method', apiLimiter, function (req, res, next) {
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
	
    app.post('/api/admin/:method', adminLimiter, function (req, res, next) {
		var method = req.params.method;
		logger.warning(logSystem, 'Admin', 'Admin API request: ' + method + ' from IP: ' + getRealIP(req));

		if (portalConfig.website && portalConfig.website.adminCenter && portalConfig.website.adminCenter.enabled) {
			if (portalConfig.website.adminCenter.password === req.body.password) {
				logger.info(logSystem, 'Admin', 'Admin authenticated for: ' + method);
				portalApi.handleAdminApiRequest(req, res, next);
			} else {
				logger.warning(logSystem, 'Admin', 'Failed admin authentication for: ' + method + ' from IP: ' + getRealIP(req));
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

		// Log full error details for debugging
		logger.error(logSystem, 'Server', 'Express error: ' + err.stack);

		// Don't expose sensitive error details to clients
		var errorResponse = {
			error: 'Internal server error',
			message: 'An error occurred while processing your request'
		};

		// Handle specific error types
		if (err instanceof URIError) {
			logger.warning(logSystem, 'Server', 'URI decode error from IP: ' + getRealIP(req) + ' - URL: ' + req.url);
			errorResponse.error = 'Invalid request';
			errorResponse.message = 'The request contains invalid characters';
			res.status(400).json(errorResponse);
		} else if (err.status === 400) {
			res.status(400).json(errorResponse);
		} else {
			res.status(500).json(errorResponse);
		}
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
