var events = require("events");
var net = require("net");

var listener = (module.exports = function listener(port, logger) {
  var _this = this;

  // Add stats tracking
  var stats = {
    totalCommands: 0,
    commandCounts: {},
    errors: 0,
    connections: 0,
    startTime: Date.now(),
  };

  var emitLog = function (text) {
    _this.emit("log", text);
    // Also log to file if logger provided
    if (logger) {
      logger.debug("CLI", "Listener", text);
    }
  };

  this.start = function () {
    var server = net
      .createServer(function (c) {
        stats.connections++;
        var clientAddress = c.remoteAddress || "unknown";

        if (logger) {
          logger.info(
            "CLI",
            "Connection",
            "New CLI connection from " + clientAddress
          );
        }

        var data = "";
        var connectionStart = Date.now();

        c.on("data", function (d) {
          try {
            data += d;

            if (data.slice(-1) === "\n") {
              var message;

              try {
                message = JSON.parse(data);
              } catch (parseError) {
                stats.errors++;
                if (logger) {
                  logger.error(
                    "CLI",
                    "Parse",
                    "Failed to parse message: " +
                      data.substring(0, 100) +
                      "... Error: " +
                      parseError.message
                  );
                }
                emitLog(
                  "CLI listener failed to parse message: " + parseError.message
                );
                c.end('{"error": "Invalid JSON"}');
                return;
              }

              if (!message.command) {
                if (logger) {
                  logger.warning(
                    "CLI",
                    "Command",
                    "Message missing command field"
                  );
                }
                c.end('{"error": "No command specified"}');
                return;
              }

              // Track command usage
              stats.totalCommands++;
              stats.commandCounts[message.command] =
                (stats.commandCounts[message.command] || 0) + 1;

              var commandStart = Date.now();

              if (logger) {
                logger.info(
                  "CLI",
                  "Command",
                  "Executing: " +
                    message.command +
                    " with params: " +
                    JSON.stringify(message.params || []).substring(0, 100)
                );
              }

              _this.emit(
                "command",
                message.command,
                message.params,
                message.options,
                function (response) {
                  var commandTime = Date.now() - commandStart;

                  if (logger) {
                    logger.debug(
                      "CLI",
                      "Response",
                      "Command " +
                        message.command +
                        " completed in " +
                        commandTime +
                        "ms"
                    );

                    if (commandTime > 1000) {
                      logger.warning(
                        "CLI",
                        "Performance",
                        "Slow command execution: " +
                          message.command +
                          " took " +
                          commandTime +
                          "ms"
                      );
                    }
                  }

                  c.end(response);
                }
              );

              // Reset data buffer after processing
              data = "";
            }

            // Prevent buffer overflow
            if (data.length > 10000) {
              stats.errors++;
              if (logger) {
                logger.error(
                  "CLI",
                  "Buffer",
                  "Data buffer overflow, disconnecting client"
                );
              }
              c.end('{"error": "Buffer overflow"}');
            }
          } catch (e) {
            stats.errors++;
            if (logger) {
              logger.error(
                "CLI",
                "Error",
                "Error processing data: " + e.message
              );
            }
            emitLog("CLI listener error: " + e.message);
            c.end('{"error": "Internal error"}');
          }
        });

        c.on("end", function () {
          var connectionTime = Date.now() - connectionStart;
          if (logger) {
            logger.debug(
              "CLI",
              "Disconnect",
              "Client " +
                clientAddress +
                " disconnected after " +
                connectionTime +
                "ms"
            );
          }
        });

        c.on("error", function (err) {
          stats.errors++;
          if (logger) {
            logger.error(
              "CLI",
              "Socket",
              "Socket error from " + clientAddress + ": " + err.message
            );
          }
        });

        c.on("timeout", function () {
          if (logger) {
            logger.warning(
              "CLI",
              "Timeout",
              "Client " + clientAddress + " timed out"
            );
          }
          c.end('{"error": "Connection timeout"}');
        });

        // Set timeout for idle connections (30 seconds)
        c.setTimeout(30000);
      })
      .listen(port, "0.0.0.0", function () {
        emitLog("CLI listening on port " + port);
        if (logger) {
          logger.success(
            "CLI",
            "Server",
            "CLI server started on localhost:" + port
          );
        }
      });

    server.on("error", function (err) {
      if (err.code === "EADDRINUSE") {
        emitLog("CLI port " + port + " already in use");
        if (logger) {
          logger.error("CLI", "Server", "Port " + port + " is already in use");
        }
      } else if (err.code === "EACCES") {
        emitLog("CLI permission denied on port " + port);
        if (logger) {
          logger.error(
            "CLI",
            "Server",
            "Permission denied to bind port " + port
          );
        }
      } else {
        emitLog("CLI server error: " + err.message);
        if (logger) {
          logger.error("CLI", "Server", "Server error: " + err.message);
        }
      }
    });

    // Log stats periodically
    if (logger) {
      setInterval(function () {
        if (stats.totalCommands > 0) {
          var uptime = Date.now() - stats.startTime;
          var topCommands = Object.keys(stats.commandCounts)
            .sort(function (a, b) {
              return stats.commandCounts[b] - stats.commandCounts[a];
            })
            .slice(0, 3)
            .map(function (cmd) {
              return cmd + "(" + stats.commandCounts[cmd] + ")";
            })
            .join(", ");

          logger.info(
            "CLI",
            "Stats",
            "Total commands: " +
              stats.totalCommands +
              ", Connections: " +
              stats.connections +
              ", Errors: " +
              stats.errors +
              ", Top commands: " +
              topCommands +
              ", Uptime: " +
              Math.floor(uptime / 1000 / 60) +
              " min"
          );
        }
      }, 300000); // Every 5 minutes
    }
  };

  // Add method to get stats
  this.getStats = function () {
    return JSON.parse(JSON.stringify(stats));
  };
});

listener.prototype.__proto__ = events.EventEmitter.prototype;
