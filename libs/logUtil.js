var dateFormat = require('dateformat');
var colors = require('colors');
var fs = require('fs');
var path = require('path');
var archiver = require('archiver'); // You'll need to install this: npm install archiver

var severityToColor = function(severity, text) {
    switch(severity) {
        case 'special':
            return text.cyan.underline;
        case 'debug':
            return text.green;
        case 'info':
            return text.white;
        case 'warning':
            return text.yellow;
        case 'error':
            return text.red;
        case 'success':
            return text.green.bold;
        default:
            console.log("Unknown severity " + severity);
            return text.italic;
    }
};

var severityValues = {
    'debug': 1,
    'info': 2,
    'warning': 3,
    'error': 4,
    'special': 5,
    'success': 6
};

var PoolLogger = function (configuration) {
    var logLevelInt = severityValues[configuration.logLevel];
    var logColors = configuration.logColors;
    var logDir = configuration.logDir || 'logs';
    var logToConsole = configuration.logToConsole !== false;
    var logToFile = configuration.logToFile !== false;
    
    // Performance metrics
    var metrics = {
        shares: { valid: 0, invalid: 0, total: 0 },
        blocks: { found: 0, confirmed: 0, orphaned: 0 },
        connections: { current: 0, total: 0 },
        hashrate: { pool: 0, network: 0 },
        lastBlockTime: null,
        startTime: Date.now()
    };
    
    // Create logs directory if it doesn't exist
    if (logToFile && !fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
	// Create write streams for different log files
	var logStreams = {};
	if (logToFile) {
		logStreams = {
			all: fs.createWriteStream(path.join(logDir, 'all.log'), { flags: 'a' }),
			error: fs.createWriteStream(path.join(logDir, 'error.log'), { flags: 'a' }),
			warning: fs.createWriteStream(path.join(logDir, 'warning.log'), { flags: 'a' }),
			payments: fs.createWriteStream(path.join(logDir, 'payments.log'), { flags: 'a' }),
			blocks: fs.createWriteStream(path.join(logDir, 'blocks.log'), { flags: 'a' }),
			solo: fs.createWriteStream(path.join(logDir, 'solo.log'), { flags: 'a' }),
			shares: fs.createWriteStream(path.join(logDir, 'shares.log'), { flags: 'a' }),
			connections: fs.createWriteStream(path.join(logDir, 'connections.log'), { flags: 'a' }),
			performance: fs.createWriteStream(path.join(logDir, 'performance.log'), { flags: 'a' }),
			bans: fs.createWriteStream(path.join(logDir, 'bans.log'), { flags: 'a' }),
			api: fs.createWriteStream(path.join(logDir, 'api.log'), { flags: 'a' }),
			auth: fs.createWriteStream(path.join(logDir, 'authorizations.log'), { flags: 'a' }),
			stats: fs.createWriteStream(path.join(logDir, 'stats.log'), { flags: 'a' }),
			website: fs.createWriteStream(path.join(logDir, 'website.log'), { flags: 'a' })
		};
	}
    
    // Rotate logs at midnight
    var scheduleDailyRotation = function() {
        if (!logToFile) return;
        
        var now = new Date();
        var night = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1, // tomorrow
            0, 0, 0 // midnight
        );
        var msToMidnight = night.getTime() - now.getTime();
        
        setTimeout(function() {
            rotateLogs();
            // Schedule next rotation
            setInterval(rotateLogs, 24 * 60 * 60 * 1000);
        }, msToMidnight);
    };
    
	var rotateLogs = function() {
		if (!logToFile) return;
		
		var dateStr = dateFormat(new Date(), 'yyyy-mm-dd');
		
		// Log rotation message
		log('info', 'Logger', 'Rotation', 'Starting log rotation for ' + dateStr);
		
		// Create archive directory if it doesn't exist
		var archiveDir = path.join(logDir, 'archive');
		if (!fs.existsSync(archiveDir)) {
			fs.mkdirSync(archiveDir, { recursive: true });
		}
		
		// Close all current streams first
		var streamsClosed = new Promise(function(resolve) {
			var closedCount = 0;
			var totalStreams = Object.keys(logStreams).length;
			
			Object.keys(logStreams).forEach(function(key) {
				if (logStreams[key]) {
					logStreams[key].end(function() {
						closedCount++;
						if (closedCount === totalStreams) {
							resolve();
						}
					});
				} else {
					closedCount++;
					if (closedCount === totalStreams) {
						resolve();
					}
				}
			});
		});
		
		// Wait for streams to close, then create zip archive
		streamsClosed.then(function() {
			// Create zip archive with all current log files
			createZipArchive(dateStr, function(err) {
				if (err) {
					console.error('Failed to create zip archive:', err);
				} else {
					// Clear/truncate log files after successful archive
					clearLogFiles();
				}
				
				// Recreate streams
				setTimeout(function() {
					Object.keys(logStreams).forEach(function(key) {
						var logPath = path.join(logDir, key + '.log');
						logStreams[key] = fs.createWriteStream(logPath, { flags: 'a' });
					});
					
					// Clean old archives and log summary
					cleanOldArchives();
					logDailySummary();
				}, 500);
			});
		});
	};
	
	var createZipArchive = function(dateStr, callback) {
		var archiveDir = path.join(logDir, 'archive');
		var zipFilePath = path.join(archiveDir, dateStr + '.zip');
		
		// Create output stream for zip file
		var output = fs.createWriteStream(zipFilePath);
		var archive = archiver('zip', {
			zlib: { level: 9 } // Maximum compression
		});
		
		// Handle stream events
		output.on('close', function() {
			console.log('Archive created: ' + zipFilePath + ' (' + formatBytes(archive.pointer()) + ')');
			callback(null);
		});
		
		output.on('end', function() {
			console.log('Archive stream ended');
		});
		
		archive.on('warning', function(err) {
			if (err.code === 'ENOENT') {
				console.warn('Archive warning:', err);
			} else {
				callback(err);
			}
		});
		
		archive.on('error', function(err) {
			callback(err);
		});
		
		// Pipe archive data to the output file
		archive.pipe(output);
		
		// Add all log files to the archive
		Object.keys(logStreams).forEach(function(key) {
			var logPath = path.join(logDir, key + '.log');
			if (fs.existsSync(logPath)) {
				var stats = fs.statSync(logPath);
				if (stats.size > 0) {
					// Add file to archive with its name
					archive.file(logPath, { name: key + '.log' });
				}
			}
		});
		
		// Add the daily summary to the archive as a separate file
		var summaryContent = generateDailySummaryText();
		archive.append(summaryContent, { name: 'daily-summary.txt' });
		
		// Finalize the archive
		archive.finalize();
	};
	
	var clearLogFiles = function() {
		// Clear/truncate all log files after successful archive
		Object.keys(logStreams).forEach(function(key) {
			var logPath = path.join(logDir, key + '.log');
			if (fs.existsSync(logPath)) {
				try {
					fs.truncateSync(logPath, 0);
				} catch (err) {
					console.error('Failed to clear log file ' + key + ':', err.message);
				}
			}
		});
	};
	
	var cleanOldArchives = function() {
		if (!logToFile) return;
		
		var archiveDir = path.join(logDir, 'archive');
		if (!fs.existsSync(archiveDir)) return;
		
		var maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
		var now = Date.now();
		
		fs.readdirSync(archiveDir).forEach(function(file) {
			// Only process .zip files
			if (!file.endsWith('.zip')) return;
			
			var filePath = path.join(archiveDir, file);
			try {
				var stats = fs.statSync(filePath);
				if (now - stats.mtime.getTime() > maxAge) {
					fs.unlinkSync(filePath);
					console.log('Deleted old archive: ' + file);
				}
			} catch (err) {
				console.error('Error checking/deleting archive ' + file + ':', err.message);
			}
		});
	};
	
	var formatBytes = function(bytes) {
		if (bytes === 0) return '0 Bytes';
		var sizes = ['Bytes', 'KB', 'MB', 'GB'];
		var i = Math.floor(Math.log(bytes) / Math.log(1024));
		return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
	};
	
	var generateDailySummaryText = function() {
		var uptime = Date.now() - metrics.startTime;
		var timestamp = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
		
		return [
			'=================================',
			'DAILY SUMMARY REPORT',
			'Generated: ' + timestamp,
			'=================================',
			'',
			'UPTIME STATISTICS:',
			'  Total Uptime: ' + formatDuration(uptime),
			'',
			'SHARE STATISTICS:',
			'  Total Shares: ' + metrics.shares.total,
			'  Valid Shares: ' + metrics.shares.valid,
			'  Invalid Shares: ' + metrics.shares.invalid,
			'  Success Rate: ' + ((metrics.shares.valid / (metrics.shares.total || 1)) * 100).toFixed(2) + '%',
			'',
			'BLOCK STATISTICS:',
			'  Blocks Found: ' + metrics.blocks.found,
			'  Blocks Confirmed: ' + metrics.blocks.confirmed,
			'  Blocks Orphaned: ' + metrics.blocks.orphaned,
			'  Last Block Time: ' + (metrics.lastBlockTime ? dateFormat(new Date(metrics.lastBlockTime), 'yyyy-mm-dd HH:MM:ss') : 'N/A'),
			'',
			'CONNECTION STATISTICS:',
			'  Total Connections: ' + metrics.connections.total,
			'  Current Active: ' + metrics.connections.current,
			'',
			'HASHRATE:',
			'  Pool Hashrate: ' + formatHashrate(metrics.hashrate.pool),
			'  Network Hashrate: ' + formatHashrate(metrics.hashrate.network),
			'',
			'================================='
		].join('\n');
	};
    
    var logDailySummary = function() {
        var summaryText = generateDailySummaryText();
        log('special', 'Logger', 'Summary', summaryText);
    };
    
    var formatDuration = function(ms) {
        var seconds = Math.floor(ms / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        var days = Math.floor(hours / 24);
        
        if (days > 0) return days + 'd ' + (hours % 24) + 'h ' + (minutes % 60) + 'm';
        if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
        if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
        return seconds + 's';
    };
    
    var formatHashrate = function(hashrate) {
        if (hashrate === 0) return '0 H/s';
        var units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
        var unitIndex = 0;
        while (hashrate >= 1000 && unitIndex < units.length - 1) {
            hashrate /= 1000;
            unitIndex++;
        }
        return hashrate.toFixed(2) + ' ' + units[unitIndex];
    };
    
    var log = function(severity, system, component, text, subcat) {
		if (severityValues[severity] < logLevelInt) return;
		
		if (subcat){
			var realText = subcat;
			var realSubCat = text;
			text = realText;
			subcat = realSubCat;
		}
		
		var timestamp = dateFormat(new Date(), 'yyyy/mm/dd HH:MM:ss');
		var entryDesc = timestamp + ' [' + system + ']\t';
		
		// Update metrics based on log content
		updateMetrics(severity, system, component, text);
		
		// Console output with colors
		if (logToConsole) {
			if (logColors) {
				entryDesc = severityToColor(severity, entryDesc);
				var logString =
						entryDesc +
						('[' + component + '] ').italic;
				if (subcat)
					logString += ('(' + subcat + ') ').bold.grey;
				if (text)
					logString += severityToColor(severity, text);
				console.log(logString);
			}
			else {
				var logString =
						entryDesc +
						'[' + component + '] ';
				if (subcat)
					logString += '(' + subcat + ') ';
				logString += text;
				console.log(logString);
			}
		}
		
		// File output (plain text without colors)
		if (logToFile) {
			var fileLogString = timestamp + ' [' + severity.toUpperCase() + '] [' + system + '] [' + component + '] ';
			if (subcat) fileLogString += '(' + subcat + ') ';
			fileLogString += text + '\n';
			
			// Helper function to safely write to stream
			var safeWrite = function(stream, data) {
				if (stream && !stream.destroyed && !stream.closed) {
					try {
						stream.write(data);
					} catch (err) {
						console.error('Failed to write to log stream:', err.message);
					}
				}
			};
			
			// Write to all.log
			safeWrite(logStreams.all, fileLogString);
			
			// Write to specific logs based on severity
			if (severity === 'error') {
				safeWrite(logStreams.error, fileLogString);
			}
			
			// Log warnings
			if (severity === 'warning') {
				safeWrite(logStreams.warning, fileLogString);
			}
			
			// System-based logging
			var systemLower = system.toLowerCase();
			
			if (systemLower === 'payments') {
				safeWrite(logStreams.payments, fileLogString);
			}
			
			// API logging
			if ((systemLower === 'api' || component.toLowerCase() === 'api')) {
				safeWrite(logStreams.api, fileLogString);
			}
			
			// AUTHORIZATION logging
			if ((systemLower === 'auth' ||
				 component.toLowerCase() === 'authorization' ||
				 component.toLowerCase() === 'auth' ||
				 text.toLowerCase().includes('authorized') ||
				 text.toLowerCase().includes('unauthorized') ||
				 text.toLowerCase().includes('authorization'))) {
				safeWrite(logStreams.auth, fileLogString);
			}
			
			// Stats logging  
			if ((systemLower === 'stats' || 
				 component.toLowerCase() === 'stats' ||
				 text.toLowerCase().includes('stats') ||
				 text.toLowerCase().includes('statistic'))) {
				safeWrite(logStreams.stats, fileLogString);
			}
			
			// Website logging
			if ((systemLower === 'website' || 
				 component.toLowerCase() === 'website' ||
				 component.toLowerCase() === 'web' ||
				 text.toLowerCase().includes('template') ||
				 text.toLowerCase().includes('page'))) {
				safeWrite(logStreams.website, fileLogString);
			}
			
			// Log blocks (both pool and solo)
			if (text && (text.toLowerCase().includes('block found') || 
						 text.toLowerCase().includes('block confirmed') ||
						 text.toLowerCase().includes('block orphaned'))) {
				safeWrite(logStreams.blocks, fileLogString);
				
				// Also log to solo.log if it's a solo block
				if (text.toLowerCase().includes('solo')) {
					safeWrite(logStreams.solo, fileLogString);
				}
			}
			
			// Log solo mining activity
			if ((component.toLowerCase().includes('solo') || 
				(text && text.toLowerCase().includes('solo')))) {
				safeWrite(logStreams.solo, fileLogString);
			}
			
			// Log share activity
			if (text && (text.toLowerCase().includes('share') || 
						text.toLowerCase().includes('difficulty'))) {
				safeWrite(logStreams.shares, fileLogString);
			}
			
			// Log connection activity
			if (text && (text.toLowerCase().includes('connected') || 
						text.toLowerCase().includes('disconnected') ||
						text.toLowerCase().includes('authorized') ||
						text.toLowerCase().includes('socket'))) {
				safeWrite(logStreams.connections, fileLogString);
			}
			
			// Log bans
			if (text && (text.toLowerCase().includes('ban') || 
						text.toLowerCase().includes('kicked') ||
						text.toLowerCase().includes('flood'))) {
				safeWrite(logStreams.bans, fileLogString);
			}
			
			// Log performance metrics
			if (text && (text.toLowerCase().includes('hashrate') || 
						text.toLowerCase().includes('performance') ||
						text.toLowerCase().includes('latency') ||
						text.toLowerCase().includes('efficiency'))) {
				safeWrite(logStreams.performance, fileLogString);
			}
		}
	};
    
    var updateMetrics = function(severity, system, component, text) {
        if (!text) return;
        
        var textLower = text.toLowerCase();
        
        // Update share metrics
        if (textLower.includes('valid share')) {
            metrics.shares.valid++;
            metrics.shares.total++;
        } else if (textLower.includes('invalid share') || textLower.includes('rejected share')) {
            metrics.shares.invalid++;
            metrics.shares.total++;
        }
        
        // Update block metrics
        if (textLower.includes('block found')) {
            metrics.blocks.found++;
            metrics.lastBlockTime = Date.now();
        } else if (textLower.includes('block confirmed')) {
            metrics.blocks.confirmed++;
        } else if (textLower.includes('block orphaned')) {
            metrics.blocks.orphaned++;
        }
        
        // Update connection metrics
        if (textLower.includes('connected')) {
            metrics.connections.current++;
            metrics.connections.total++;
        } else if (textLower.includes('disconnected')) {
            metrics.connections.current = Math.max(0, metrics.connections.current - 1);
        }
        
        // Extract hashrate if present
        var hashrateMatch = text.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?H\/s)/i);
        if (hashrateMatch) {
            var value = parseFloat(hashrateMatch[1]);
            var unit = hashrateMatch[2].toUpperCase();
            var multiplier = 1;
            
            if (unit.startsWith('K')) multiplier = 1000;
            else if (unit.startsWith('M')) multiplier = 1000000;
            else if (unit.startsWith('G')) multiplier = 1000000000;
            else if (unit.startsWith('T')) multiplier = 1000000000000;
            else if (unit.startsWith('P')) multiplier = 1000000000000000;
            
            if (textLower.includes('pool')) {
                metrics.hashrate.pool = value * multiplier;
            } else if (textLower.includes('network')) {
                metrics.hashrate.network = value * multiplier;
            }
        }
    };
    
    // Start rotation scheduler
    if (logToFile) {
        scheduleDailyRotation();
    }
    
    // public methods
    var _this = this;
    Object.keys(severityValues).forEach(function(logType){
        _this[logType] = function(){
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(logType);
            log.apply(this, args);
        };
    });
    
    // Add method to get metrics
    _this.getMetrics = function() {
        return JSON.parse(JSON.stringify(metrics));
    };
    
    // Add method to log with custom data
    _this.logWithData = function(severity, system, component, text, data) {
        var dataStr = data ? ' | Data: ' + JSON.stringify(data) : '';
        log(severity, system, component, text + dataStr);
    };
    
    // Add method for structured logging
    _this.logStructured = function(options) {
        var severity = options.severity || 'info';
        var system = options.system || 'System';
        var component = options.component || 'Component';
        var text = options.text || '';
        var data = options.data || {};
        
        // Format structured data
        var formattedData = Object.keys(data).map(function(key) {
            return key + '=' + JSON.stringify(data[key]);
        }).join(' ');
        
        var fullText = text + (formattedData ? ' | ' + formattedData : '');
        log(severity, system, component, fullText);
    };
    
    // Add method to manually trigger archive creation (useful for testing)
    _this.createArchiveNow = function(callback) {
        var dateStr = dateFormat(new Date(), 'yyyy-mm-dd-HHMMss');
        createZipArchive(dateStr, callback || function() {});
    };
    
    // Cleanup on exit
    process.on('exit', function() {
        if (logToFile) {
            // Log shutdown message
            log('info', 'Logger', 'Shutdown', 'Pool shutting down gracefully');
            
            // Close all streams
            Object.keys(logStreams).forEach(function(key) {
                if (logStreams[key]) logStreams[key].end();
            });
        }
    });
    
	// Handle uncaught exceptions
	process.on('uncaughtException', function(err) {
		// Don't try to log if streams are closed
		if (logStreams.error && !logStreams.error.destroyed) {
			log('error', 'Logger', 'UncaughtException', err.stack || err.message || err);
		} else {
			// Fallback to console if log streams are closed
			console.error('[UncaughtException]', err.stack || err.message || err);
		}
	});

	// Handle unhandled promise rejections
	process.on('unhandledRejection', function(reason, promise) {
		if (logStreams.error && !logStreams.error.destroyed) {
			log('error', 'Logger', 'UnhandledRejection', 'Reason: ' + (reason.stack || reason));
		} else {
			console.error('[UnhandledRejection]', reason.stack || reason);
		}
	});
};

module.exports = PoolLogger;