// Modern Miner Stats JS using Chart.js
// Global variables
var workerHashrateChart;
// Chart history window: 4 hours of data points
// This will be dynamically calculated based on actual update interval
// Default: 4 hours / 90 seconds = 160 data points
var workerHistoryMax = 160;
var statData;
var totalHash;
var totalImmature;
var totalBal;
var totalPaid;
var totalShares;
var _workerCount = 0;
var _miner = window.location.pathname.split("/").pop() || "";

// Chart.js default configuration
Chart.defaults.color = "#94a3b8";
Chart.defaults.borderColor = "rgba(255, 255, 255, 0.1)";
Chart.defaults.font.family =
  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// =====================
// Helper Functions
// =====================

function getReadableHashRateString(hashrate) {
  hashrate = parseFloat(hashrate) * 1000000;
  if (isNaN(hashrate) || hashrate < 1000000) {
    return "0 H/s";
  }
  var byteUnits = [
    " H/s",
    " KH/s",
    " MH/s",
    " GH/s",
    " TH/s",
    " PH/s",
    " EH/s",
    " ZH/s",
    " YH/s",
  ];
  var i = Math.floor(Math.log(hashrate / 1000) / Math.log(1000) - 1);
  hashrate = hashrate / 1000 / Math.pow(1000, i + 1);
  return hashrate.toFixed(2) + byteUnits[i];
}

function getReadableLuckTime(lucktime) {
  var luck = parseFloat(lucktime);
  if (isNaN(luck) || !isFinite(luck)) {
    return "N/A";
  }
  var timeUnits = [" Days", " Hours", " Minutes"];
  if (luck < 1) {
    luck = luck * 24;
    if (luck < 1) {
      luck = luck * 60;
      return luck.toFixed(2) + timeUnits[2];
    } else {
      return luck.toFixed(2) + timeUnits[1];
    }
  }
  return luck.toFixed(3) + timeUnits[0];
}

function getWorkerNameFromAddress(w) {
  var worker = w;
  // Check if there's a dot in the address (indicating a worker name)
  if (w.indexOf(".") > -1) {
    var parts = w.split(".");
    // Get everything after the first dot as the worker name
    worker = parts.slice(1).join(".");
    // If worker name is empty or just whitespace, use "noname"
    if (!worker || worker.trim().length === 0) {
      worker = "noname";
    }
  } else {
    // No dot found, so no worker name provided
    worker = "noname";
  }
  return worker;
}

// =====================
// Chart Functions
// =====================

function destroyExistingChart() {
  if (workerHashrateChart) {
    workerHashrateChart.destroy();
    workerHashrateChart = null;
  }
}

function initChart() {
  var ctx = document.getElementById("workerHashrateChart");
  if (!ctx) return;

  // Destroy existing chart if it exists
  destroyExistingChart();

  workerHashrateChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 15,
            usePointStyle: true,
            font: {
              size: 11,
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(26, 31, 46, 0.95)",
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: function (context) {
              return (
                context.dataset.label +
                ": " +
                getReadableHashRateString(context.parsed.y)
              );
            },
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: {
            displayFormats: {
              hour: "HH:mm",
              minute: "HH:mm",
            },
          },
          grid: {
            display: false,
          },
          ticks: {
            maxTicksLimit: 8,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
          },
          ticks: {
            callback: function (value) {
              return getReadableHashRateString(value);
            },
          },
        },
      },
    },
  });
}

function buildChartData() {
  if (!statData || !statData.history) return;

  var datasets = [];
  var colors = [
    "rgb(59, 130, 246)", // Blue
    "rgb(168, 85, 247)", // Purple
    "rgb(16, 185, 129)", // Green
    "rgb(245, 158, 11)", // Orange
    "rgb(239, 68, 68)", // Red
    "rgb(236, 72, 153)", // Pink
    "rgb(34, 211, 238)", // Cyan
    "rgb(251, 191, 36)", // Yellow
  ];

  var colorIndex = 0;

  // Process all workers from history
  for (var w in statData.history) {
    var worker = getWorkerNameFromAddress(w);
    var isSolo =
      statData.workers && statData.workers[w] && statData.workers[w].isSolo;

    if (isSolo) {
      worker = worker + " (SOLO)";
    }

    var data = [];
    for (var wh in statData.history[w]) {
      data.push({
        x: statData.history[w][wh].time * 1000,
        y: statData.history[w][wh].hashrate,
      });
    }

    // Keep only last workerHistoryMax points
    if (data.length > workerHistoryMax) {
      data = data.slice(-workerHistoryMax);
    }

    var color = colors[colorIndex % colors.length];
    datasets.push({
      label: worker,
      data: data,
      borderColor: color,
      backgroundColor: color + "20",
      borderWidth: 2,
      fill: false,
      tension: 0.2,
      pointRadius: 0,
      pointHoverRadius: 5,
      hidden: colorIndex > Math.min(_workerCount - 1, 3),
    });

    colorIndex++;
  }

  if (workerHashrateChart) {
    workerHashrateChart.data.datasets = datasets;
    workerHashrateChart.update("none");
  }
}

function updateChartData() {
  if (!statData || !statData.history) return false;

  var needsRebuild = false;

  for (var w in statData.history) {
    var worker = getWorkerNameFromAddress(w);
    var isSolo =
      statData.workers && statData.workers[w] && statData.workers[w].isSolo;

    if (isSolo) {
      worker = worker + " (SOLO)";
    }

    // Find dataset for this worker
    var dataset = null;
    for (var i = 0; i < workerHashrateChart.data.datasets.length; i++) {
      if (workerHashrateChart.data.datasets[i].label === worker) {
        dataset = workerHashrateChart.data.datasets[i];
        break;
      }
    }

    if (!dataset) {
      needsRebuild = true;
      break;
    }

    // Get latest history entry
    var latestEntry = null;
    var latestTime = 0;
    for (var wh in statData.history[w]) {
      if (statData.history[w][wh].time > latestTime) {
        latestTime = statData.history[w][wh].time;
        latestEntry = statData.history[w][wh];
      }
    }

    if (latestEntry) {
      // Check if this data point already exists
      var exists = false;
      for (var j = 0; j < dataset.data.length; j++) {
        if (dataset.data[j].x === latestEntry.time * 1000) {
          exists = true;
          break;
        }
      }

      if (!exists) {
        // Add new data point
        dataset.data.push({
          x: latestEntry.time * 1000,
          y: latestEntry.hashrate,
        });

        // Remove old points if exceeding max
        if (dataset.data.length > workerHistoryMax) {
          dataset.data.shift();
        }
      }
    }
  }

  if (needsRebuild) {
    buildChartData();
    if (typeof rebuildWorkerDisplay === "function") {
      rebuildWorkerDisplay();
    }
    return true;
  } else if (workerHashrateChart) {
    workerHashrateChart.update("none");
    return false;
  }
  return false;
}

// =====================
// Statistics Functions
// =====================

function calculateAverageHashrate(worker) {
  var totalSum = 0;
  var totalCount = 0;

  if (workerHashrateChart && workerHashrateChart.data.datasets) {
    for (var i = 0; i < workerHashrateChart.data.datasets.length; i++) {
      var dataset = workerHashrateChart.data.datasets[i];

      // Check if this dataset matches the worker we're looking for
      if (
        worker == null ||
        dataset.label === worker ||
        dataset.label === worker + " (SOLO)"
      ) {
        // Add all data points from this dataset
        for (var j = 0; j < dataset.data.length; j++) {
          totalSum += parseFloat(dataset.data[j].y);
          totalCount++;
        }
      }
    }
  }

  // Return the average (avoid division by zero)
  if (totalCount > 0) {
    return totalSum / totalCount;
  }
  return 0;
}

function updateStats() {
  if (!statData) return;

  // Calculate totalHash from all workers
  totalHash = 0;
  for (var w in statData.workers) {
    totalHash += parseFloat(statData.workers[w].hashrate) || 0;
  }
  totalPaid = parseFloat(statData.paid) || 0;
  totalBal = parseFloat(statData.balance) || 0;
  totalImmature = parseFloat(statData.immature) || 0;
  totalShares = parseFloat(statData.totalShares) || 0;

  // Calculate luck days for all workers
  var luckDays = 0;
  var validWorkers = 0;

  for (var w in statData.workers) {
    var workerLuck = parseFloat(statData.workers[w].luckDays);
    if (!isNaN(workerLuck) && isFinite(workerLuck) && workerLuck > 0) {
      luckDays = luckDays + 1 / workerLuck;
      validWorkers++;
    }
  }

  if (validWorkers > 0) {
    luckDays = 1 / luckDays;
  } else {
    luckDays = 0;
  }

  // Update display elements
  $("#statsHashrate").text(getReadableHashRateString(totalHash));
  $("#statsHashrateAvg").text(
    getReadableHashRateString(calculateAverageHashrate(null))
  );
  $("#statsLuckDays").text(getReadableLuckTime(luckDays));
  $("#statsTotalImmature").text(totalImmature.toFixed(8));
  $("#statsTotalBal").text(totalBal.toFixed(8));
  $("#statsTotalPaid").text(totalPaid.toFixed(8));
  $("#statsTotalShares").text(getReadableSharesString(totalShares));
}

function updateWorkerStats() {
  if (!statData || !statData.workers) return;

  for (var w in statData.workers) {
    var worker = statData.workers[w];
    var isSolo = worker.isSolo === true;
    var htmlSafeWorkerName =
      (isSolo ? "solo_" : "") +
      w
        .split(".")
        .join("_")
        .replace(/[^\w\s]/gi, "");
    var saneWorkerName = getWorkerNameFromAddress(w);

    $("#statsHashrate" + htmlSafeWorkerName).text(
      getReadableHashRateString(worker.hashrate)
    );
    $("#statsHashrateAvg" + htmlSafeWorkerName).text(
      getReadableHashRateString(calculateAverageHashrate(saneWorkerName))
    );
    $("#statsLuckDays" + htmlSafeWorkerName).text(
      getReadableLuckTime(worker.luckDays)
    );
    $("#statsPaid" + htmlSafeWorkerName).text(
      parseFloat(worker.paid || 0).toFixed(8)
    );
    $("#statsBalance" + htmlSafeWorkerName).text(
      parseFloat(worker.balance || 0).toFixed(8)
    );
    $("#statsShares" + htmlSafeWorkerName).text(
      getReadableSharesString(worker.currRoundShares || 0)
    );
    $("#statsDiff" + htmlSafeWorkerName).text(
      getReadableDifficultyString(worker.diff) || "N/A"
    );
  }
}

// =====================
// Initialization
// =====================

function loadWorkerStats() {
  var url = "/api/worker_stats?addr=" + window._miner;
  console.log("Loading worker stats from:", url);

  $.getJSON(url, function (data) {
    console.log("Received worker data:", data);
    window.statData = data; // Make it global
    _workerCount = 0;

    for (var w in window.statData.workers) {
      _workerCount++;
    }

    // Calculate optimal history max based on update interval
    // Try to get from global stats config, or use default
    calculateWorkerHistoryMax();

    buildChartData();
    if (typeof rebuildWorkerDisplay === "function") {
      rebuildWorkerDisplay();
    }
    updateStats();
    updateWorkerStats();
  }).fail(function (jqXHR, textStatus, errorThrown) {
    console.error("Failed to load worker stats:", errorThrown);
    console.error("Response:", jqXHR.responseText);
  });
}

function calculateWorkerHistoryMax() {
  // Target: Show 4 hours of history
  var targetHistorySeconds = 14400; // 4 hours

  // Try to get update interval from global stats
  var updateInterval = 90; // Default

  if (
    window.statsData &&
    window.statsData.config &&
    window.statsData.config.website &&
    window.statsData.config.website.stats &&
    window.statsData.config.website.stats.updateInterval
  ) {
    updateInterval = window.statsData.config.website.stats.updateInterval;
  }

  // Calculate how many data points we need for 4 hours
  var calculatedMax = Math.ceil(targetHistorySeconds / updateInterval);

  // Limit between 20 and 500 points to avoid extremes
  calculatedMax = Math.max(20, Math.min(500, calculatedMax));

  workerHistoryMax = calculatedMax;
  console.log(
    "Worker history max set to:",
    workerHistoryMax,
    "points (",
    ((workerHistoryMax * updateInterval) / 60).toFixed(1),
    "minutes)"
  );
}

$(document).ready(function () {
  // Only initialize if we're on a worker stats page
  if (document.getElementById("workerHashrateChart")) {
    // Initialize chart
    initChart();

    // Load initial data
    loadWorkerStats();

    // Listen to the global statsUpdate event instead of creating another EventSource
    $(document).on("statsUpdate", function (event, globalStats) {
      if (document.hidden) return;

      // Only reload worker stats data when global stats update
      // This avoids duplicate API calls
      $.getJSON("/api/worker_stats?addr=" + _miner, function (data) {
        statData = data;

        // Check for worker count changes
        var wc = 0;
        var rebuilt = false;

        for (var w in statData.workers) {
          wc++;
        }

        if (_workerCount != wc) {
          if (_workerCount > wc && typeof rebuildWorkerDisplay === "function") {
            rebuildWorkerDisplay();
            rebuilt = true;
          }
          _workerCount = wc;
        }

        rebuilt = rebuilt || updateChartData();
        updateStats();

        if (!rebuilt) {
          updateWorkerStats();
        }
      });
    });
  }
});

// Handle window resize
window.addEventListener("resize", function () {
  if (workerHashrateChart) {
    workerHashrateChart.resize();
  }
});

// Clean up on page unload
window.addEventListener("beforeunload", function () {
  destroyExistingChart();
});
