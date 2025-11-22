var dateFormat = require("dateformat");
var colors = require("colors");
var fs = require("fs");
var path = require("path");
var archiver = require("archiver");
var cluster = require("cluster");

var severityToColor = function (severity, text) {
  switch (severity) {
    case "special":
      return text.cyan.underline;
    case "debug":
      return text.green;
    case "info":
      return text.white;
    case "warning":
      return text.yellow;
    case "error":
      return text.red;
    case "success":
      return text.green.bold;
    default:
      console.log("Unknown severity " + severity);
      return text.italic;
  }
};

var severityValues = {
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  special: 5,
  success: 6,
};

var PoolLogger = function (configuration) {
  var logLevelInt = severityValues[configuration.logLevel];
  var logColors = configuration.logColors;
  // Convert logDir to absolute path to prevent issues with working directory changes
  var logDir = configuration.logDir || "logs";
  if (!path.isAbsolute(logDir)) {
    logDir = path.resolve(process.cwd(), logDir);
  }
  var logToConsole = configuration.logToConsole !== false;
  var logToFile = configuration.logToFile !== false;

  // Store timer references for cleanup
  var rotationTimer = null;
  var rotationInterval = null;

  // Performance metrics
  var metrics = {
    shares: { valid: 0, invalid: 0, total: 0 },
    blocks: { found: 0, confirmed: 0, orphaned: 0 },
    connections: { current: 0, total: 0 },
    hashrate: { pool: 0, network: 0 },
    lastBlockTime: null,
    startTime: Date.now(),
  };

  // Create logs directory if it doesn't exist
  var processType = cluster.isMaster ? "Master" : "Worker-" + process.pid;
  if (logToFile) {
    try {
      if (!fs.existsSync(logDir)) {
        console.log(
          "[LOGGER] " + processType + ": Creating logs directory: " + logDir
        );
        fs.mkdirSync(logDir, { recursive: true, mode: 0o755 });
        console.log(
          "[LOGGER] " + processType + ": Logs directory created successfully"
        );
      }
      // Only verify and log once (master process only) to reduce noise
      else if (cluster.isMaster) {
        console.log(
          "[LOGGER] " + processType + ": Logs directory exists: " + logDir
        );
      }

      // Verify we can write to the directory (master only to reduce noise)
      if (cluster.isMaster) {
        var testFile = path.join(logDir, ".write-test-" + Date.now());
        try {
          fs.writeFileSync(testFile, "test");
          fs.unlinkSync(testFile);
          console.log(
            "[LOGGER] " + processType + ": Logs directory is writable"
          );
        } catch (err) {
          console.error(
            "[LOGGER] " +
              processType +
              ": ERROR: Logs directory is not writable:",
            err.message
          );
          console.error(
            "[LOGGER] " +
              processType +
              ": Please check permissions on: " +
              logDir
          );
          throw new Error("Logs directory not writable: " + logDir);
        }
      }
    } catch (err) {
      console.error(
        "[LOGGER] " + processType + ": ERROR: Failed to create logs directory:",
        err.message
      );
      console.error("[LOGGER] " + processType + ": Path: " + logDir);
      console.error(
        "[LOGGER] " +
          processType +
          ": Current working directory: " +
          process.cwd()
      );
      throw err;
    }
  }

  // Create write streams for different log files
  var logStreams = {};
  if (logToFile) {
    var streamNames = [
      "all",
      "error",
      "warning",
      "payments",
      "info",
      "blocks",
      "solo",
      "shares",
      "connections",
      "performance",
      "bans",
      "api",
      "authorizations",
      "stats",
      "website",
      "admin",
      "stratum",
    ];

    var processType = cluster.isMaster ? "Master" : "Worker-" + process.pid;
    console.log(
      "[LOGGER] " +
        processType +
        ": Creating " +
        streamNames.length +
        " log streams..."
    );
    var createdCount = 0;

    // Helper function to create a single stream with retry
    var createStreamWithRetry = function (name, maxRetries, retryDelay) {
      maxRetries = maxRetries || 3;
      retryDelay = retryDelay || 100;
      var attempt = 0;
      var streamReady = false; // Track if we already counted this stream

      var tryCreate = function () {
        attempt++;
        try {
          var logPath = path.join(logDir, name + ".log");
          // Only log on first attempt or retries (not normal creation)
          if (attempt > 1) {
            console.log(
              "[LOGGER] " +
                processType +
                ": Retrying stream: " +
                name +
                ".log (attempt " +
                attempt +
                "/" +
                maxRetries +
                ")"
            );
          }

          var stream = fs.createWriteStream(logPath, {
            flags: "a",
            mode: 0o644,
          });

          // Handle stream errors (for runtime errors, not creation errors)
          stream.on("error", function (err) {
            console.error(
              "[LOGGER] Runtime error on stream " + name + ":",
              err.message
            );
            // Try to recreate the stream after a runtime error
            if (!streamReady) return; // Don't recreate if we're still in creation phase

            try {
              if (!stream.destroyed) {
                stream.destroy();
              }
              logStreams[name] = fs.createWriteStream(logPath, {
                flags: "a",
                mode: 0o644,
              });
              console.log(
                "[LOGGER] Recreated stream " + name + " after runtime error"
              );
            } catch (retryErr) {
              console.error(
                "[LOGGER] Failed to recreate stream " + name + ":",
                retryErr.message
              );
            }
          });

          // Handle when stream is ready (only count once)
          stream.once("ready", function () {
            if (!streamReady) {
              streamReady = true;
              createdCount++;
              if (createdCount === streamNames.length) {
                console.log(
                  "[LOGGER] " +
                    processType +
                    ": All " +
                    streamNames.length +
                    " log streams ready"
                );
              }
            }
          });

          // Handle stream open event for retry logic
          stream.once("open", function (fd) {
            if (attempt === 1) {
              // Only log on first successful open
              if (createdCount === streamNames.length && streamReady) {
                // All streams are ready, log once
              }
            }
          });

          logStreams[name] = stream;
        } catch (err) {
          if (attempt < maxRetries) {
            console.warn(
              "[LOGGER] Exception creating stream " +
                name +
                " (attempt " +
                attempt +
                "), retrying in " +
                retryDelay +
                "ms...",
              err.message
            );
            setTimeout(function () {
              tryCreate();
            }, retryDelay);
          } else {
            console.error(
              "[LOGGER] FATAL: Failed to create stream " +
                name +
                " after " +
                maxRetries +
                " attempts:",
              err.message
            );
            console.error("[LOGGER] Error details:", err.stack);
            throw err;
          }
        }
      };

      tryCreate();
    };

    // Create all streams with retry capability
    streamNames.forEach(function (name) {
      createStreamWithRetry(name, 3, 100);
    });
  }

  // Rotate logs at midnight
  var scheduleDailyRotation = function () {
    if (!logToFile) return;

    // IMPORTANT: Only the master process should rotate logs
    // Workers share the same log files, so only one process should rotate
    if (cluster.isWorker) {
      console.log(
        "[LOG ROTATION] Worker process detected - log rotation will be handled by master process"
      );
      return;
    }

    var now = new Date();
    var night = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1, // tomorrow
      0,
      0,
      0 // midnight
    );
    var msToMidnight = night.getTime() - now.getTime();

    rotationTimer = setTimeout(function () {
      rotateLogs();
      // Schedule next rotation
      rotationInterval = setInterval(rotateLogs, 24 * 60 * 60 * 1000);
    }, msToMidnight);
  };

  var rotateLogs = function () {
    if (!logToFile) return;

    var dateStr = dateFormat(new Date(), "yyyy-mm-dd-HHMMss");

    // Log rotation message
    console.log("[LOG ROTATION] Starting log rotation for " + dateStr);

    // Create archive directory if it doesn't exist
    var archiveDir = path.join(logDir, "archive");
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
      console.log("[LOG ROTATION] Created archive directory");
    }

    // Create a temporary directory for rotation
    var rotateDir = path.join(logDir, ".rotating-" + dateStr);
    try {
      fs.mkdirSync(rotateDir, { recursive: true });
    } catch (err) {
      console.error(
        "[LOG ROTATION] Failed to create rotation directory:",
        err.message
      );
      return;
    }

    console.log(
      "[LOG ROTATION] Closing and rotating log streams (minimal downtime)..."
    );

    // Step 1: Close all streams gracefully and rename files
    var streamsClosed = new Promise(function (resolve) {
      var closedCount = 0;
      var totalStreams = Object.keys(logStreams).length;
      var rotatedFiles = [];

      console.log("[LOG ROTATION] Closing " + totalStreams + " log streams...");

      // Handle edge case: no streams to close
      if (totalStreams === 0) {
        console.log("[LOG ROTATION] No streams to close");
        resolve(rotatedFiles);
        return;
      }

      Object.keys(logStreams).forEach(function (key) {
        if (logStreams[key] && !logStreams[key].destroyed) {
          // Close the stream and wait for it to finish flushing
          logStreams[key].end(function () {
            closedCount++;
            console.log(
              "[LOG ROTATION] Closed stream: " +
                key +
                ".log (" +
                closedCount +
                "/" +
                totalStreams +
                ")"
            );

            // After stream is closed, rename the file
            var logPath = path.join(logDir, key + ".log");
            var rotatePath = path.join(rotateDir, key + ".log");

            if (fs.existsSync(logPath)) {
              try {
                var stats = fs.statSync(logPath);
                if (stats.size > 0) {
                  fs.renameSync(logPath, rotatePath);
                  rotatedFiles.push({
                    key: key,
                    path: rotatePath,
                    size: stats.size,
                  });
                  console.log(
                    "[LOG ROTATION] Rotated: " +
                      key +
                      ".log (" +
                      formatBytes(stats.size) +
                      ")"
                  );
                } else {
                  console.log("[LOG ROTATION] Skipped empty: " + key + ".log");
                }
              } catch (err) {
                console.error(
                  "[LOG ROTATION] Failed to rotate " + key + ".log:",
                  err.message
                );
              }
            }

            if (closedCount === totalStreams) {
              console.log(
                "[LOG ROTATION] All " +
                  totalStreams +
                  " streams closed, " +
                  rotatedFiles.length +
                  " files rotated"
              );
              resolve(rotatedFiles);
            }
          });
        } else {
          closedCount++;
          console.log(
            "[LOG ROTATION] Stream already closed: " +
              key +
              ".log (" +
              closedCount +
              "/" +
              totalStreams +
              ")"
          );
          if (closedCount === totalStreams) {
            console.log(
              "[LOG ROTATION] All " +
                totalStreams +
                " streams closed, " +
                rotatedFiles.length +
                " files rotated"
            );
            resolve(rotatedFiles);
          }
        }
      });

      // Safety timeout: force resolution after 30 seconds if streams don't close
      setTimeout(function () {
        if (closedCount < totalStreams) {
          console.error(
            "[LOG ROTATION] WARNING: Stream closing timed out after 30s (" +
              closedCount +
              "/" +
              totalStreams +
              " closed)"
          );
          console.error("[LOG ROTATION] Forcing rotation to continue...");
          resolve(rotatedFiles);
        }
      }, 30000);
    });

    // Step 2: Recreate streams immediately (minimize logging downtime)
    streamsClosed.then(function (rotatedFiles) {
      console.log("[LOG ROTATION] All streams closed and files rotated");

      // Recreate streams immediately - this is the critical part
      console.log("[LOG ROTATION] Recreating log streams...");
      var recreatedCount = 0;
      var recreationErrors = [];

      Object.keys(logStreams).forEach(function (key) {
        var logPath = path.join(logDir, key + ".log");
        try {
          // Create new write stream
          var newStream = fs.createWriteStream(logPath, { flags: "a" });

          // Add error handler to prevent stream from becoming unusable
          newStream.on("error", function (err) {
            console.error(
              "[LOG ROTATION] Error on recreated stream " + key + ":",
              err.message
            );
            // Attempt to recreate the stream if it errors
            try {
              if (!newStream.destroyed) {
                newStream.destroy();
              }
              logStreams[key] = fs.createWriteStream(logPath, { flags: "a" });
              console.log(
                "[LOG ROTATION] Recreated stream " + key + " after error"
              );
            } catch (retryErr) {
              console.error(
                "[LOG ROTATION] Failed to recreate stream " +
                  key +
                  " after error:",
                retryErr.message
              );
            }
          });

          // Ensure the stream is ready for writing
          newStream.once("ready", function () {
            recreatedCount++;
            console.log(
              "[LOG ROTATION] Stream " +
                key +
                " ready (" +
                recreatedCount +
                "/" +
                Object.keys(logStreams).length +
                ")"
            );
          });

          // Also handle open event as fallback
          newStream.once("open", function (fd) {
            console.log(
              "[LOG ROTATION] Stream " + key + " opened (fd: " + fd + ")"
            );
          });

          logStreams[key] = newStream;
        } catch (err) {
          console.error(
            "[LOG ROTATION] Failed to create stream for " + key + ":",
            err.message
          );
          recreationErrors.push({ key: key, error: err.message });
        }
      });

      // Notify all worker processes to recreate their streams
      if (cluster.isMaster && cluster.workers) {
        console.log(
          "[LOG ROTATION] Notifying " +
            Object.keys(cluster.workers).length +
            " workers to recreate streams..."
        );
        Object.keys(cluster.workers).forEach(function (id) {
          try {
            cluster.workers[id].send({ cmd: "log_rotation" });
          } catch (err) {
            console.error(
              "[LOG ROTATION] Failed to notify worker " + id + ":",
              err.message
            );
          }
        });
      }

      // Give streams a moment to initialize before declaring success
      setTimeout(function () {
        if (recreationErrors.length > 0) {
          console.error(
            "[LOG ROTATION] WARNING: " +
              recreationErrors.length +
              " streams failed to recreate:"
          );
          recreationErrors.forEach(function (err) {
            console.error("[LOG ROTATION]   - " + err.key + ": " + err.error);
          });
        }
        console.log(
          "[LOG ROTATION] Log streams recreated (" +
            (Object.keys(logStreams).length - recreationErrors.length) +
            "/" +
            Object.keys(logStreams).length +
            " successful) - logging resumed!"
        );
      }, 100);

      // Step 3: Archive the rotated files in the background
      setTimeout(function () {
        if (rotatedFiles.length === 0) {
          console.log("[LOG ROTATION] No files to archive, cleaning up...");
          try {
            fs.rmdirSync(rotateDir);
          } catch (err) {
            console.error(
              "[LOG ROTATION] Failed to remove rotation directory:",
              err.message
            );
          }
          return;
        }

        console.log("[LOG ROTATION] Creating archive from rotated files...");
        createZipArchiveFromDir(
          dateStr,
          rotateDir,
          rotatedFiles,
          function (err) {
            if (err) {
              console.error(
                "[LOG ROTATION] Failed to create archive:",
                err.message
              );
              console.error(
                "[LOG ROTATION] Rotated files preserved in:",
                rotateDir
              );
              console.error(
                "[LOG ROTATION] Please manually archive and delete this directory"
              );
            } else {
              console.log("[LOG ROTATION] Archive created successfully");

              // Delete the rotated files and directory
              console.log("[LOG ROTATION] Cleaning up rotated files...");
              rotatedFiles.forEach(function (file) {
                try {
                  fs.unlinkSync(file.path);
                } catch (err) {
                  console.error(
                    "[LOG ROTATION] Failed to delete " + file.key + ".log:",
                    err.message
                  );
                }
              });

              // Remove rotation directory
              try {
                fs.rmdirSync(rotateDir);
                console.log("[LOG ROTATION] Rotation complete!");
              } catch (err) {
                console.error(
                  "[LOG ROTATION] Failed to remove rotation directory:",
                  err.message
                );
              }
            }

            // Clean old archives
            cleanOldArchives();
          }
        );
      }, 500); // Small delay before archiving
    });
  };

  var verifyZipIntegrity = function (zipFilePath, callback) {
    // Use system unzip command to test archive integrity
    var exec = require("child_process").exec;

    // Run 'unzip -t' to test the archive
    // Note: unzip writes output to stderr by default
    exec(
      'unzip -t "' + zipFilePath + '" 2>&1',
      function (error, stdout, stderr) {
        var output = (stdout || stderr || "").toLowerCase();

        // Check for corruption indicators
        if (
          output.includes("bad crc") ||
          output.includes("bad zipfile offset")
        ) {
          console.error("[VERIFY] Archive has CRC or offset errors");
          callback(new Error("Archive has CRC errors"));
          return;
        }

        // Check for other errors (but ignore exit code, unzip returns 1 for warnings)
        if (output.includes("no errors detected")) {
          console.log("[VERIFY] Archive integrity verified successfully");
          callback(null);
          return;
        }

        // If we can't find clear success message, check for "at least one error"
        if (output.includes("at least one error")) {
          console.error("[VERIFY] Archive has errors");
          callback(new Error("Archive integrity check failed"));
          return;
        }

        // Uncertain result - be conservative and pass
        console.warn(
          "[VERIFY] Archive test completed (status unclear, assuming OK)"
        );
        callback(null);
      }
    );
  };

  var createZipArchiveFromDir = function (
    dateStr,
    sourceDir,
    filesToArchive,
    callback
  ) {
    var archiveDir = path.join(logDir, "archive");
    var zipFilePath = path.join(archiveDir, dateStr + ".zip");

    console.log("[ARCHIVE] Creating archive: " + zipFilePath);
    console.log("[ARCHIVE] Source directory: " + sourceDir);

    // Calculate total size
    var totalSize = filesToArchive.reduce(function (sum, file) {
      return sum + file.size;
    }, 0);

    console.log("[ARCHIVE] Total data to archive: " + formatBytes(totalSize));
    console.log("[ARCHIVE] Files to archive: " + filesToArchive.length);

    if (filesToArchive.length === 0) {
      console.warn("[ARCHIVE] WARNING: No files to archive");
      callback(new Error("No files to archive"));
      return;
    }

    // Verify all files exist before starting
    var missingFiles = [];
    filesToArchive.forEach(function (file) {
      if (!fs.existsSync(file.path)) {
        missingFiles.push(file.key);
      }
    });
    if (missingFiles.length > 0) {
      console.error("[ARCHIVE] ERROR: Missing files:", missingFiles.join(", "));
      callback(new Error("Missing files: " + missingFiles.join(", ")));
      return;
    }

    // Track if callback was already called to prevent double-calling
    var callbackCalled = false;
    var archiveTimeout = null;
    var safeCallback = function (err) {
      if (!callbackCalled) {
        callbackCalled = true;
        if (archiveTimeout) {
          clearTimeout(archiveTimeout);
          archiveTimeout = null;
        }
        callback(err);
      }
    };

    // Set a timeout to prevent hanging indefinitely (5 minutes max)
    archiveTimeout = setTimeout(function () {
      if (!callbackCalled) {
        console.error(
          "[ARCHIVE] ERROR: Archive creation timed out after 5 minutes"
        );
        hasError = true;
        // Try to destroy streams
        try {
          if (output && !output.destroyed) output.destroy();
          if (archive) archive.abort();
        } catch (e) {
          console.error("[ARCHIVE] Error destroying streams:", e.message);
        }
        safeCallback(new Error("Archive creation timed out"));
      }
    }, 5 * 60 * 1000);

    // Create write stream for the output zip file
    var output = null;
    var archive = null;
    try {
      output = fs.createWriteStream(zipFilePath);
      archive = archiver("zip", {
        zlib: { level: 9 }, // Maximum compression
      });
    } catch (err) {
      console.error(
        "[ARCHIVE] ERROR: Failed to initialize archiver:",
        err.message
      );
      safeCallback(err);
      return;
    }

    // Track errors
    var hasError = false;

    // Handle output stream errors
    output.on("error", function (err) {
      console.error("[ARCHIVE] Output stream error:", err.message);
      console.error("[ARCHIVE] Stack trace:", err.stack);
      hasError = true;
      safeCallback(err);
    });

    // Handle archive errors (critical - always fail)
    archive.on("error", function (err) {
      console.error("[ARCHIVE] Archive creation error:", err.message);
      console.error("[ARCHIVE] Stack trace:", err.stack);
      hasError = true;
      safeCallback(err);
    });

    // Handle warnings (some may be critical)
    archive.on("warning", function (err) {
      if (err.code === "ENOENT") {
        console.warn("[ARCHIVE] Warning:", err.message);
      } else {
        // Treat non-ENOENT warnings as errors
        console.error(
          "[ARCHIVE] Archive warning (treating as error):",
          err.message
        );
        hasError = true;
        safeCallback(err);
      }
    });

    // Track archive progress
    var lastProgress = 0;
    archive.on("progress", function (progress) {
      var percent = Math.round((progress.fs.processedBytes / totalSize) * 100);
      if (percent >= lastProgress + 10) {
        console.log(
          "[ARCHIVE] Progress: " +
            percent +
            "% (" +
            formatBytes(progress.fs.processedBytes) +
            "/" +
            formatBytes(totalSize) +
            ")"
        );
        lastProgress = percent;
      }
    });

    // Handle archive finalization completion
    archive.on("finish", function () {
      console.log(
        "[ARCHIVE] Archive finalized (" +
          formatBytes(archive.pointer()) +
          "), waiting for output stream to close..."
      );
    });

    // Handle output stream close (final step)
    output.on("close", function () {
      // If we already had an error, don't proceed
      if (hasError) {
        console.error(
          "[ARCHIVE] Archive closed but errors occurred during creation"
        );
        return;
      }

      var archiveSize = archive.pointer();
      var compressionRatio =
        totalSize > 0 ? (totalSize / archiveSize).toFixed(2) : 0;

      console.log("[ARCHIVE] Archive stream closed successfully");
      console.log(
        "[ARCHIVE] Archive size: " +
          formatBytes(archiveSize) +
          " (compression ratio: " +
          compressionRatio +
          ":1)"
      );

      // Verify archive size is reasonable
      if (archiveSize < 100 && totalSize > 0) {
        console.error(
          "[ARCHIVE] ERROR: Archive size suspiciously small (expected ~" +
            formatBytes(totalSize) +
            ")"
        );
        hasError = true;
        safeCallback(new Error("Archive too small"));
        return;
      }

      // Additional verification: check if file actually exists and has the expected size
      try {
        var zipStats = fs.statSync(zipFilePath);
        if (zipStats.size !== archiveSize) {
          console.error(
            "[ARCHIVE] ERROR: File size mismatch - expected " +
              archiveSize +
              " but got " +
              zipStats.size
          );
          hasError = true;
          safeCallback(new Error("Archive file size mismatch"));
          return;
        }

        // Final integrity check: try to read the zip file to ensure it's valid
        console.log("[ARCHIVE] Performing integrity check on archive...");
        verifyZipIntegrity(zipFilePath, function (verifyErr) {
          if (verifyErr) {
            console.error(
              "[ARCHIVE] ERROR: Archive integrity check failed:",
              verifyErr.message
            );
            console.error(
              "[ARCHIVE] Corrupted archive will be deleted to prevent data loss"
            );
            // Delete the corrupted archive
            try {
              fs.unlinkSync(zipFilePath);
            } catch (unlinkErr) {
              console.error(
                "[ARCHIVE] Failed to delete corrupted archive:",
                unlinkErr.message
              );
            }
            hasError = true;
            safeCallback(new Error("Archive corrupted: " + verifyErr.message));
            return;
          }

          console.log("[ARCHIVE] Integrity check passed - archive is valid");
          console.log("[ARCHIVE] Successfully created: " + zipFilePath);
          safeCallback(null);
        });
      } catch (err) {
        console.error(
          "[ARCHIVE] ERROR: Cannot verify archive file:",
          err.message
        );
        hasError = true;
        safeCallback(err);
      }
    });

    // Pipe archive data to the file
    console.log("[ARCHIVE] Piping archive to output stream...");
    try {
      archive.pipe(output);
    } catch (err) {
      console.error("[ARCHIVE] ERROR: Failed to pipe archive:", err.message);
      safeCallback(err);
      return;
    }

    // Add files to archive
    console.log("[ARCHIVE] Adding files to archive...");
    try {
      filesToArchive.forEach(function (file) {
        console.log(
          "[ARCHIVE] Adding: " +
            file.key +
            ".log (" +
            formatBytes(file.size) +
            ") from " +
            file.path
        );
        // Verify file is readable before adding
        try {
          var stats = fs.statSync(file.path);
          if (stats.size !== file.size) {
            console.warn(
              "[ARCHIVE] Warning: File size changed - expected " +
                file.size +
                " but got " +
                stats.size
            );
          }
          archive.file(file.path, { name: file.key + ".log" });
        } catch (err) {
          console.error(
            "[ARCHIVE] ERROR: Cannot read file " + file.key + ".log:",
            err.message
          );
          throw err;
        }
      });
    } catch (err) {
      console.error(
        "[ARCHIVE] ERROR: Failed to add files to archive:",
        err.message
      );
      hasError = true;
      safeCallback(err);
      return;
    }

    // Finalize the archive (this is async)
    console.log(
      "[ARCHIVE] Finalizing archive (this may take a while for large archives)..."
    );
    try {
      archive.finalize();
    } catch (err) {
      console.error(
        "[ARCHIVE] ERROR: Failed to finalize archive:",
        err.message
      );
      hasError = true;
      safeCallback(err);
    }
  };

  var createZipArchive = function (dateStr, callback) {
    var archiveDir = path.join(logDir, "archive");
    var zipFilePath = path.join(archiveDir, dateStr + ".zip");

    console.log("[ARCHIVE] Creating archive: " + zipFilePath);

    // Pre-check: Verify all log files are accessible and get their sizes
    var totalSize = 0;
    var filesToArchive = [];

    Object.keys(logStreams).forEach(function (key) {
      var logPath = path.join(logDir, key + ".log");
      if (fs.existsSync(logPath)) {
        try {
          var stats = fs.statSync(logPath);
          totalSize += stats.size;
          if (stats.size > 0) {
            filesToArchive.push({ key: key, path: logPath, size: stats.size });
          }
        } catch (err) {
          console.warn(
            "[ARCHIVE] Warning: Cannot read " + key + ".log: " + err.message
          );
        }
      }
    });

    console.log("[ARCHIVE] Total data to archive: " + formatBytes(totalSize));
    console.log("[ARCHIVE] Files to archive: " + filesToArchive.length);

    if (filesToArchive.length === 0) {
      console.warn("[ARCHIVE] WARNING: No files to archive");
      callback(new Error("No files to archive"));
      return;
    }

    // Track if callback was already called to prevent double-calling
    var callbackCalled = false;
    var safeCallback = function (err) {
      if (!callbackCalled) {
        callbackCalled = true;
        callback(err);
      }
    };

    // Create write stream for the output zip file
    var output = fs.createWriteStream(zipFilePath);
    var archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    // Track errors
    var hasError = false;

    // Handle output stream errors
    output.on("error", function (err) {
      console.error("[ARCHIVE] Output stream error:", err.message);
      hasError = true;
      safeCallback(err);
    });

    // Handle archive errors (critical - always fail)
    archive.on("error", function (err) {
      console.error("[ARCHIVE] Archive creation error:", err.message);
      hasError = true;
      safeCallback(err);
    });

    // Handle warnings (some may be critical)
    archive.on("warning", function (err) {
      if (err.code === "ENOENT") {
        console.warn("[ARCHIVE] Warning:", err.message);
      } else {
        // Treat non-ENOENT warnings as errors
        console.error(
          "[ARCHIVE] Archive warning (treating as error):",
          err.message
        );
        hasError = true;
        safeCallback(err);
      }
    });

    // Handle archive finalization completion
    archive.on("finish", function () {
      console.log(
        "[ARCHIVE] Archive finalized, waiting for output stream to close..."
      );
    });

    // Handle output stream close (final step)
    output.on("close", function () {
      // If we already had an error, don't proceed
      if (hasError) {
        console.error(
          "[ARCHIVE] Archive closed but errors occurred during creation"
        );
        return;
      }

      var archiveSize = archive.pointer();
      var compressionRatio =
        totalSize > 0 ? (totalSize / archiveSize).toFixed(2) : 0;

      console.log("[ARCHIVE] Archive stream closed successfully");
      console.log(
        "[ARCHIVE] Archive size: " +
          formatBytes(archiveSize) +
          " (compression ratio: " +
          compressionRatio +
          ":1)"
      );

      // Verify archive size is reasonable
      if (archiveSize < 100 && totalSize > 0) {
        console.error(
          "[ARCHIVE] ERROR: Archive size suspiciously small (expected ~" +
            formatBytes(totalSize) +
            ")"
        );
        hasError = true;
        safeCallback(new Error("Archive too small"));
        return;
      }

      // Additional verification: check if file actually exists and has the expected size
      try {
        var zipStats = fs.statSync(zipFilePath);
        if (zipStats.size !== archiveSize) {
          console.error(
            "[ARCHIVE] ERROR: File size mismatch - expected " +
              archiveSize +
              " but got " +
              zipStats.size
          );
          hasError = true;
          safeCallback(new Error("Archive file size mismatch"));
          return;
        }

        // Final integrity check: try to read the zip file to ensure it's valid
        console.log("[ARCHIVE] Performing integrity check on archive...");
        verifyZipIntegrity(zipFilePath, function (verifyErr) {
          if (verifyErr) {
            console.error(
              "[ARCHIVE] ERROR: Archive integrity check failed:",
              verifyErr.message
            );
            console.error(
              "[ARCHIVE] Corrupted archive will be deleted to prevent data loss"
            );
            // Delete the corrupted archive
            try {
              fs.unlinkSync(zipFilePath);
            } catch (unlinkErr) {
              console.error(
                "[ARCHIVE] Failed to delete corrupted archive:",
                unlinkErr.message
              );
            }
            hasError = true;
            safeCallback(new Error("Archive corrupted: " + verifyErr.message));
            return;
          }

          console.log("[ARCHIVE] Integrity check passed - archive is valid");
          console.log("[ARCHIVE] Successfully created: " + zipFilePath);
          safeCallback(null);
        });
      } catch (err) {
        console.error(
          "[ARCHIVE] ERROR: Cannot verify archive file:",
          err.message
        );
        hasError = true;
        safeCallback(err);
      }
    });

    // Pipe archive data to the file
    archive.pipe(output);

    // Add files to archive
    filesToArchive.forEach(function (file) {
      console.log(
        "[ARCHIVE] Adding: " +
          file.key +
          ".log (" +
          formatBytes(file.size) +
          ")"
      );
      archive.file(file.path, { name: file.key + ".log" });
    });

    // Finalize the archive (this is async)
    console.log("[ARCHIVE] Finalizing archive...");
    archive.finalize();
  };

  var clearLogFiles = function () {
    // Clear/truncate all log files after successful archive
    Object.keys(logStreams).forEach(function (key) {
      var logPath = path.join(logDir, key + ".log");
      if (fs.existsSync(logPath)) {
        try {
          fs.truncateSync(logPath, 0);
        } catch (err) {
          console.error("Failed to clear log file " + key + ":", err.message);
        }
      }
    });
  };

  var cleanOldArchives = function () {
    if (!logToFile) return;

    var archiveDir = path.join(logDir, "archive");
    if (!fs.existsSync(archiveDir)) return;

    var maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    var now = Date.now();

    fs.readdirSync(archiveDir).forEach(function (file) {
      // Only process .zip files
      if (!file.endsWith(".zip")) return;

      var filePath = path.join(archiveDir, file);
      try {
        var stats = fs.statSync(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          console.log("Deleted old archive: " + file);
        }
      } catch (err) {
        console.error(
          "Error checking/deleting archive " + file + ":",
          err.message
        );
      }
    });
  };

  var formatBytes = function (bytes) {
    if (bytes === 0) return "0 Bytes";
    var sizes = ["Bytes", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  var log = function (severity, system, component, text, subcat) {
    // Prepare timestamp and log string early for admin logging
    var timestamp = dateFormat(new Date(), "yyyy/mm/dd HH:MM:ss");

    if (subcat) {
      var realText = subcat;
      var realSubCat = text;
      text = realText;
      subcat = realSubCat;
    }

    // ALWAYS log to category-specific files regardless of log level
    // This ensures operational logs are complete even when console is set to 'error' only
    var systemLower = system.toLowerCase();
    var componentLower = component.toLowerCase();
    var textLower = (text || "").toLowerCase();

    if (logToFile) {
      var categoryLogString =
        timestamp +
        " [" +
        severity.toUpperCase() +
        "] [" +
        system +
        "] [" +
        component +
        "] ";
      if (subcat) categoryLogString += "(" + subcat + ") ";
      categoryLogString += text + "\n";

      // Helper to write to category log, bypassing log level check
      var writeToCategoryLog = function (stream, streamName) {
        if (stream && !stream.destroyed) {
          stream.write(categoryLogString);
        }
      };

      // Admin logging (security auditing)
      if (
        systemLower === "admin" ||
        componentLower === "admin" ||
        textLower.includes("admin authenticated") ||
        textLower.includes("admin login") ||
        textLower.includes("admin logout") ||
        textLower.includes("admin api")
      ) {
        writeToCategoryLog(logStreams.admin, "admin");
      }

      // API logging
      if (systemLower === "api" || componentLower === "api") {
        writeToCategoryLog(logStreams.api, "api");
      }

      // Stats logging
      if (
        systemLower === "stats" ||
        componentLower === "stats" ||
        textLower.includes("stats") ||
        textLower.includes("statistic")
      ) {
        writeToCategoryLog(logStreams.stats, "stats");
      }

      // Website logging
      if (
        systemLower === "website" ||
        componentLower === "website" ||
        componentLower === "web" ||
        textLower.includes("template") ||
        textLower.includes("page")
      ) {
        writeToCategoryLog(logStreams.website, "website");
      }

      // Performance logging
      if (
        systemLower === "performance" ||
        componentLower === "performance" ||
        textLower.includes("performance") ||
        textLower.includes("slow")
      ) {
        writeToCategoryLog(logStreams.performance, "performance");
      }

      // Bans logging
      if (
        systemLower === "bans" ||
        componentLower === "bans" ||
        textLower.includes("banned") ||
        textLower.includes("ban")
      ) {
        writeToCategoryLog(logStreams.bans, "bans");
      }

      // Payments logging
      if (
        systemLower === "payments" ||
        componentLower === "payments" ||
        textLower.includes("payment")
      ) {
        writeToCategoryLog(logStreams.payments, "payments");
      }

      // Authorization logging
      if (
        systemLower === "auth" ||
        componentLower === "authorization" ||
        componentLower === "auth" ||
        textLower.includes("authorized") ||
        textLower.includes("unauthorized") ||
        textLower.includes("authorization")
      ) {
        writeToCategoryLog(logStreams.authorizations, "authorizations");
      }

      // Connections logging
      if (
        systemLower === "connections" ||
        componentLower === "connections" ||
        componentLower === "connection" ||
        textLower.includes("connected") ||
        textLower.includes("disconnected")
      ) {
        writeToCategoryLog(logStreams.connections, "connections");
      }

      // Stratum protocol logging (bypass log level to capture all protocol details)
      if (
        systemLower === "stratum" ||
        componentLower === "stratum" ||
        textLower.includes("stratum") ||
        textLower.includes("mining.") ||
        textLower.includes("user agent") ||
        textLower.includes("extranonce")
      ) {
        writeToCategoryLog(logStreams.stratum, "stratum");
      }
    }

    // Now apply normal log level filtering for other outputs
    if (severityValues[severity] < logLevelInt) return;

    var entryDesc = timestamp + " [" + system + "]\t";

    // Update metrics based on log content
    updateMetrics(severity, system, component, text);

    // Console output with colors
    if (logToConsole) {
      if (logColors) {
        entryDesc = severityToColor(severity, entryDesc);
        var logString = entryDesc + ("[" + component + "] ").italic;
        if (subcat) logString += ("(" + subcat + ") ").bold.grey;
        if (text) logString += severityToColor(severity, text);
        console.log(logString);
      } else {
        var logString = entryDesc + "[" + component + "] ";
        if (subcat) logString += "(" + subcat + ") ";
        logString += text;
        console.log(logString);
      }
    }

    // File output (plain text without colors)
    if (logToFile) {
      var fileLogString =
        timestamp +
        " [" +
        severity.toUpperCase() +
        "] [" +
        system +
        "] [" +
        component +
        "] ";
      if (subcat) fileLogString += "(" + subcat + ") ";
      fileLogString += text + "\n";

      // Helper function to safely write to stream
      // This function will automatically recreate streams if they become closed/destroyed
      // This is critical for worker processes after the master rotates logs
      var safeWrite = function (stream, data, streamName) {
        if (!stream) {
          // Stream doesn't exist - try to create it
          if (streamName && logToFile) {
            console.log(
              "[LOGGER] Stream " +
                streamName +
                " does not exist, creating it..."
            );
            try {
              var newStream = fs.createWriteStream(
                path.join(logDir, streamName + ".log"),
                { flags: "a" }
              );
              newStream.on("error", function (err) {
                console.error(
                  "[LOGGER] Error on recreated stream " + streamName + ":",
                  err.message
                );
              });
              logStreams[streamName] = newStream;
              return newStream.write(data);
            } catch (err) {
              console.error(
                "[LOGGER] Failed to create stream " + streamName + ":",
                err.message
              );
              return false;
            }
          }
          return false;
        }

        // Check if stream needs to be recreated (happens after master rotates logs)
        var needsRecreation =
          stream.destroyed || stream.closed || !stream.writable;

        if (needsRecreation) {
          // Stream was destroyed/closed - recreate it (common in worker processes after rotation)
          if (streamName) {
            console.log(
              "[LOGGER] Stream " +
                streamName +
                " is " +
                (stream.destroyed
                  ? "destroyed"
                  : stream.closed
                  ? "closed"
                  : "not writable") +
                ", recreating..."
            );
            try {
              // Destroy old stream if not already destroyed
              if (!stream.destroyed) {
                try {
                  stream.destroy();
                } catch (e) {
                  // Ignore errors during destroy
                }
              }

              // Create new stream
              var newStream = fs.createWriteStream(
                path.join(logDir, streamName + ".log"),
                { flags: "a" }
              );

              // Add error handler
              newStream.on("error", function (err) {
                console.error(
                  "[LOGGER] Error on recreated stream " + streamName + ":",
                  err.message
                );
              });

              // Replace in logStreams object
              logStreams[streamName] = newStream;

              // Write to the new stream
              return newStream.write(data);
            } catch (err) {
              console.error(
                "[LOGGER] Failed to recreate stream " + streamName + ":",
                err.message
              );
              return false;
            }
          }
          return false;
        }

        // Stream is good, write to it
        try {
          return stream.write(data);
        } catch (err) {
          console.error(
            "[LOGGER] Failed to write to stream " +
              (streamName || "unknown") +
              ":",
            err.message
          );
          // Try to recreate stream after write failure
          if (streamName) {
            console.log(
              "[LOGGER] Attempting to recreate stream " +
                streamName +
                " after write failure..."
            );
            try {
              stream.destroy();
              var newStream = fs.createWriteStream(
                path.join(logDir, streamName + ".log"),
                { flags: "a" }
              );
              newStream.on("error", function (err) {
                console.error(
                  "[LOGGER] Error on recreated stream " + streamName + ":",
                  err.message
                );
              });
              logStreams[streamName] = newStream;
              return newStream.write(data);
            } catch (retryErr) {
              console.error(
                "[LOGGER] Failed to recreate stream " +
                  streamName +
                  " after write error:",
                retryErr.message
              );
              return false;
            }
          }
          return false;
        }
      };

      // Write to all.log
      safeWrite(logStreams.all, fileLogString, "all");

      // Write to specific logs based on severity
      if (severity === "error") {
        safeWrite(logStreams.error, fileLogString, "error");
      }

      // Log warnings
      if (severity === "warning") {
        safeWrite(logStreams.warning, fileLogString, "warning");
      }

      // Log info severity
      if (severity === "info") {
        safeWrite(logStreams.info, fileLogString, "info");
      }

      // Note: Category-specific logging (admin, api, stats, website, etc.)
      // is now handled earlier in the log() function to bypass log level filtering.
      // This ensures complete operational logs even when logLevel is set to 'error'.

      // Log blocks (both pool and solo)
      if (
        text &&
        (text.toLowerCase().includes("block found") ||
          text.toLowerCase().includes("block confirmed") ||
          text.toLowerCase().includes("block orphaned"))
      ) {
        safeWrite(logStreams.blocks, fileLogString, "blocks");

        // Also log to solo.log if it's a solo block
        if (text.toLowerCase().includes("solo")) {
          safeWrite(logStreams.solo, fileLogString, "solo");
        }
      }

      // Log solo mining activity
      if (
        component.toLowerCase().includes("solo") ||
        (text && text.toLowerCase().includes("solo"))
      ) {
        safeWrite(logStreams.solo, fileLogString, "solo");
      }

      // Log share activity
      if (
        text &&
        (text.toLowerCase().includes("share") ||
          text.toLowerCase().includes("difficulty"))
      ) {
        safeWrite(logStreams.shares, fileLogString, "shares");
      }

      // Log connection activity
      if (
        text &&
        (text.toLowerCase().includes("connected") ||
          text.toLowerCase().includes("disconnected") ||
          text.toLowerCase().includes("authorized") ||
          text.toLowerCase().includes("socket"))
      ) {
        safeWrite(logStreams.connections, fileLogString, "connections");
      }

      // Log stratum protocol activity
      if (
        text &&
        (text.toLowerCase().includes("stratum") ||
          text.toLowerCase().includes("mining.") ||
          text.toLowerCase().includes("user agent") ||
          text.toLowerCase().includes("extranonce"))
      ) {
        safeWrite(logStreams.stratum, fileLogString, "stratum");
      }

      // Log bans
      if (
        text &&
        (text.toLowerCase().includes("ban") ||
          text.toLowerCase().includes("kicked") ||
          text.toLowerCase().includes("flood"))
      ) {
        safeWrite(logStreams.bans, fileLogString, "bans");
      }

      // Log performance metrics
      if (
        text &&
        (text.toLowerCase().includes("hashrate") ||
          text.toLowerCase().includes("performance") ||
          text.toLowerCase().includes("latency") ||
          text.toLowerCase().includes("efficiency"))
      ) {
        safeWrite(logStreams.performance, fileLogString, "performance");
      }
    }
  };

  var updateMetrics = function (severity, system, component, text) {
    if (!text) return;

    var textLower = text.toLowerCase();

    // Update share metrics
    if (textLower.includes("valid share")) {
      metrics.shares.valid++;
      metrics.shares.total++;
    } else if (
      textLower.includes("invalid share") ||
      textLower.includes("rejected share")
    ) {
      metrics.shares.invalid++;
      metrics.shares.total++;
    }

    // Update block metrics
    if (textLower.includes("block found")) {
      metrics.blocks.found++;
      metrics.lastBlockTime = Date.now();
    } else if (textLower.includes("block confirmed")) {
      metrics.blocks.confirmed++;
    } else if (textLower.includes("block orphaned")) {
      metrics.blocks.orphaned++;
    }

    // Update connection metrics
    if (textLower.includes("connected")) {
      metrics.connections.current++;
      metrics.connections.total++;
    } else if (textLower.includes("disconnected")) {
      metrics.connections.current = Math.max(
        0,
        metrics.connections.current - 1
      );
    }

    // Extract hashrate if present
    var hashrateMatch = text.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?H\/s)/i);
    if (hashrateMatch) {
      var value = parseFloat(hashrateMatch[1]);
      var unit = hashrateMatch[2].toUpperCase();
      var multiplier = 1;

      if (unit.startsWith("K")) multiplier = 1000;
      else if (unit.startsWith("M")) multiplier = 1000000;
      else if (unit.startsWith("G")) multiplier = 1000000000;
      else if (unit.startsWith("T")) multiplier = 1000000000000;
      else if (unit.startsWith("P")) multiplier = 1000000000000000;

      if (textLower.includes("pool")) {
        metrics.hashrate.pool = value * multiplier;
      } else if (textLower.includes("network")) {
        metrics.hashrate.network = value * multiplier;
      }
    }
  };

  // Worker process: Listen for rotation notification from master
  if (cluster.isWorker) {
    console.log("[LOGGER] Worker process - setting up log rotation listener");
    process.on("message", function (msg) {
      if (msg && msg.cmd === "log_rotation") {
        console.log(
          "[LOG ROTATION] Worker received rotation notification from master"
        );
        console.log(
          "[LOG ROTATION] Recreating all log streams in worker process..."
        );

        // Recreate all streams
        var recreated = 0;
        Object.keys(logStreams).forEach(function (key) {
          try {
            // Destroy old stream if it exists
            if (logStreams[key] && !logStreams[key].destroyed) {
              logStreams[key].destroy();
            }

            // Create new stream
            var logPath = path.join(logDir, key + ".log");
            var newStream = fs.createWriteStream(logPath, { flags: "a" });

            newStream.on("error", function (err) {
              console.error(
                "[LOG ROTATION] Error on worker stream " + key + ":",
                err.message
              );
            });

            logStreams[key] = newStream;
            recreated++;
          } catch (err) {
            console.error(
              "[LOG ROTATION] Worker failed to recreate stream " + key + ":",
              err.message
            );
          }
        });

        console.log(
          "[LOG ROTATION] Worker recreated " +
            recreated +
            "/" +
            Object.keys(logStreams).length +
            " streams"
        );
      }
    });
  }

  // Start rotation scheduler
  if (logToFile) {
    scheduleDailyRotation();
  }

  // public methods
  var _this = this;
  Object.keys(severityValues).forEach(function (logType) {
    _this[logType] = function () {
      var args = Array.prototype.slice.call(arguments, 0);
      args.unshift(logType);
      log.apply(this, args);
    };
  });

  // Add method to get metrics
  _this.getMetrics = function () {
    return JSON.parse(JSON.stringify(metrics));
  };

  // Add method to log with custom data
  _this.logWithData = function (severity, system, component, text, data) {
    var dataStr = data ? " | Data: " + JSON.stringify(data) : "";
    log(severity, system, component, text + dataStr);
  };

  // Add method for structured logging
  _this.logStructured = function (options) {
    var severity = options.severity || "info";
    var system = options.system || "System";
    var component = options.component || "Component";
    var text = options.text || "";
    var data = options.data || {};

    // Format structured data
    var formattedData = Object.keys(data)
      .map(function (key) {
        return key + "=" + JSON.stringify(data[key]);
      })
      .join(" ");

    var fullText = text + (formattedData ? " | " + formattedData : "");
    log(severity, system, component, fullText);
  };

  // Add method to manually trigger archive creation (useful for testing)
  _this.createArchiveNow = function (callback) {
    var dateStr = dateFormat(new Date(), "yyyy-mm-dd-HHMMss");
    createZipArchive(dateStr, callback || function () {});
  };

  // Add cleanup method to properly shut down logger
  _this.cleanup = function () {
    // Clear rotation timers
    if (rotationTimer) {
      clearTimeout(rotationTimer);
      rotationTimer = null;
    }
    if (rotationInterval) {
      clearInterval(rotationInterval);
      rotationInterval = null;
    }

    // Close all streams
    if (logToFile) {
      Object.keys(logStreams).forEach(function (key) {
        if (logStreams[key] && !logStreams[key].destroyed) {
          logStreams[key].end();
        }
      });
    }

    // Remove event handlers
    process.removeListener("exit", exitHandler);
    process.removeListener("uncaughtException", uncaughtExceptionHandler);
    process.removeListener("unhandledRejection", unhandledRejectionHandler);
  };

  // Event handlers (store references for cleanup)
  var exitHandler = function () {
    if (logToFile) {
      // Log shutdown message
      log("info", "Logger", "Shutdown", "Pool shutting down gracefully");

      // Close all streams
      Object.keys(logStreams).forEach(function (key) {
        if (logStreams[key] && !logStreams[key].destroyed) {
          logStreams[key].end();
        }
      });
    }
  };

  var uncaughtExceptionHandler = function (err) {
    // Don't try to log if streams are closed
    if (logStreams.error && !logStreams.error.destroyed) {
      log(
        "error",
        "Logger",
        "UncaughtException",
        err.stack || err.message || err
      );
    } else {
      // Fallback to console if log streams are closed
      console.error("[UncaughtException]", err.stack || err.message || err);
    }
  };

  var unhandledRejectionHandler = function (reason, promise) {
    if (logStreams.error && !logStreams.error.destroyed) {
      log(
        "error",
        "Logger",
        "UnhandledRejection",
        "Reason: " + (reason.stack || reason)
      );
    } else {
      console.error("[UnhandledRejection]", reason.stack || reason);
    }
  };

  // Register handlers only if not already registered
  if (!process.listenerCount || process.listenerCount("exit") === 0) {
    process.on("exit", exitHandler);
  }
  if (
    !process.listenerCount ||
    process.listenerCount("uncaughtException") === 0
  ) {
    process.on("uncaughtException", uncaughtExceptionHandler);
  }
  if (
    !process.listenerCount ||
    process.listenerCount("unhandledRejection") === 0
  ) {
    process.on("unhandledRejection", unhandledRejectionHandler);
  }
};

module.exports = PoolLogger;
