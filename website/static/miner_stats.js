var workerHashrateData;
var workerHashrateChart;
var workerHistoryMax = 160;

var statData;
var totalHash;
var totalImmature;
var totalBal;
var totalPaid;
var totalShares;

function getReadableHashRateString(hashrate) {
  hashrate = parseFloat(hashrate) * 1000000; // Parse to number
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
  var luck = parseFloat(lucktime); // Parse to number
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

function timeOfDayFormat(timestamp) {
  var dStr = d3.time.format("%I:%M %p")(new Date(timestamp));
  if (dStr.indexOf("0") === 0) dStr = dStr.slice(1);
  return dStr;
}

function getWorkerNameFromAddress(w) {
  var worker = w;
  if (w.split(".").length > 1) {
    worker = w.split(".")[1];
    if (worker == null || worker.length < 1) {
      worker = "noname";
    }
  } else {
    worker = "noname";
  }
  return worker;
}

function buildChartData() {
  var workers = {};

  // Process all workers from history
  for (var w in statData.history) {
    var worker = getWorkerNameFromAddress(w);
    // Check if this is a solo worker
    if (statData.workers && statData.workers[w] && statData.workers[w].isSolo) {
      worker = worker + " (SOLO)";
    }

    var a = (workers[worker] = workers[worker] || {
      hashrate: [],
    });
    for (var wh in statData.history[w]) {
      a.hashrate.push([
        statData.history[w][wh].time * 1000,
        statData.history[w][wh].hashrate,
      ]);
    }
    if (a.hashrate.length > workerHistoryMax) {
      workerHistoryMax = a.hashrate.length;
    }
  }

  var i = 0;
  workerHashrateData = [];
  for (var worker in workers) {
    workerHashrateData.push({
      key: worker,
      disabled: i > Math.min(_workerCount - 1, 3),
      values: workers[worker].hashrate,
    });
    i++;
  }
}

function updateChartData() {
  // Process all workers from history
  for (var w in statData.history) {
    var worker = getWorkerNameFromAddress(w);
    // Check if this is a solo worker and add label
    if (statData.workers && statData.workers[w] && statData.workers[w].isSolo) {
      worker = worker + " (SOLO)";
    }

    var foundWorker = false;
    for (var i = 0; i < workerHashrateData.length; i++) {
      if (workerHashrateData[i].key === worker) {
        foundWorker = true;
        // get latest history entry
        for (var wh in statData.history[w]) {
        }
        if (workerHashrateData[i].values.length >= workerHistoryMax) {
          workerHashrateData[i].values.shift();
        }
        workerHashrateData[i].values.push([
          statData.history[w][wh].time * 1000,
          statData.history[w][wh].hashrate,
        ]);
        break;
      }
    }

    if (!foundWorker) {
      // Get last history entry
      for (var wh in statData.history[w]) {
      }
      var hashrate = [];
      hashrate.push([
        statData.history[w][wh].time * 1000,
        statData.history[w][wh].hashrate,
      ]);
      workerHashrateData.push({
        key: worker,
        values: hashrate,
      });
      rebuildWorkerDisplay();
      return true;
    }
  }

  triggerChartUpdates();
  return false;
}

function calculateAverageHashrate(worker) {
  var count = 0;
  var total = 1;
  var avg = 0;

  for (var i = 0; i < workerHashrateData.length; i++) {
    count = 0;
    for (var ii = 0; ii < workerHashrateData[i].values.length; ii++) {
      if (
        worker == null ||
        workerHashrateData[i].key === worker ||
        workerHashrateData[i].key === worker + " (SOLO)"
      ) {
        count++;
        avg += parseFloat(workerHashrateData[i].values[ii][1]);
      }
    }
    if (count > total) total = count;
  }
  avg = avg / total;
  return avg;
}

function triggerChartUpdates() {
  if (workerHashrateChart) {
    workerHashrateChart.update();
  }
}

function displayCharts() {
  nv.addGraph(function () {
    workerHashrateChart = nv.models
      .lineChart()
      .margin({ left: 80, right: 30 })
      .x(function (d) {
        return d[0];
      })
      .y(function (d) {
        return d[1];
      })
      .useInteractiveGuideline(true);

    workerHashrateChart.xAxis.tickFormat(timeOfDayFormat);

    workerHashrateChart.yAxis.tickFormat(function (d) {
      return getReadableHashRateString(d);
    });
    d3.select("#workerHashrate")
      .datum(workerHashrateData)
      .call(workerHashrateChart);
    return workerHashrateChart;
  });
}

function updateStats() {
  totalHash = parseFloat(statData.totalHash) || 0;
  totalPaid = parseFloat(statData.paid) || 0;
  totalBal = parseFloat(statData.balance) || 0;
  totalImmature = parseFloat(statData.immature) || 0;
  totalShares = parseFloat(statData.totalShares) || 0;

  // Calculate luck days for all workers (pool and solo)
  var luckDays = 0;
  var validWorkers = 0;

  // Process all workers
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

  // update miner stats
  $("#statsHashrate").text(getReadableHashRateString(totalHash));
  $("#statsHashrateAvg").text(
    getReadableHashRateString(calculateAverageHashrate(null))
  );
  $("#statsLuckDays").text(getReadableLuckTime(luckDays));
  $("#statsTotalImmature").text(totalImmature.toFixed(8));
  $("#statsTotalBal").text(totalBal.toFixed(8));
  $("#statsTotalPaid").text(totalPaid.toFixed(8));
  $("#statsTotalShares").text((totalShares / 1000000).toFixed(2) + "M");
}

function updateWorkerStats() {
  var i = 0;
  for (var w in statData.workers) {
    i++;
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
      Math.round(parseFloat(worker.currRoundShares || 0) * 100) / 100
    );
    $("#statsDiff" + htmlSafeWorkerName).text(worker.diff);
  }
}

function addWorkerToDisplay(name, htmlSafeName, workerObj, isSolo) {
  var htmlToAdd = "";
  var soloLabel = isSolo ? ' <span style="color: #FFD700;">[SOLO]</span>' : "";
  htmlToAdd =
    '<div class="boxStats" id="boxStatsLeft" style="float:left; margin: 9px; min-width: 260px;"><div class="boxStatsList">';
  htmlToAdd +=
    '<div class="boxLowerHeader">' +
    name.replace(/[^\w\s]/gi, "") +
    soloLabel +
    "</div><div>";
  htmlToAdd +=
    '<div><i class="fas fa-tachometer-alt fa-fw"></i> <span id="statsHashrate' +
    htmlSafeName +
    '">' +
    getReadableHashRateString(workerObj.hashrate) +
    "</span> (Now)</div>";
  htmlToAdd +=
    '<div><i class="fas fa-tachometer-alt fa-fw"></i> <span id="statsHashrateAvg' +
    htmlSafeName +
    '">' +
    getReadableHashRateString(
      calculateAverageHashrate(isSolo ? name + " (SOLO)" : name)
    ) +
    "</span> (Avg)</div>";
  htmlToAdd +=
    '<div><i class="fas fa-unlock-alt fa-fw"></i> <small>Diff:</small> <span id="statsDiff' +
    htmlSafeName +
    '">' +
    workerObj.diff +
    "</span></div>";
  htmlToAdd +=
    '<div><i class="fas fa-cog fa-fw"></i> <small>Shares:</small> <span id="statsShares' +
    htmlSafeName +
    '">' +
    Math.round(parseFloat(workerObj.currRoundShares || 0) * 100) / 100 +
    "</span></div>";
  htmlToAdd +=
    '<div><i class="fas fa-clock fa-fw"></i> <small>Luck:</small> <span id="statsLuckDays' +
    htmlSafeName +
    '">' +
    getReadableLuckTime(workerObj.luckDays) +
    "</span></div>";
  htmlToAdd +=
    '<div><i class="fas fa-money-bill-alt fa-fw"></i> <small>Bal:</small> <span id="statsBalance' +
    htmlSafeName +
    '">' +
    parseFloat(workerObj.balance || 0).toFixed(8) +
    "</span></div>";
  htmlToAdd +=
    '<div><i class="fas fa-money-bill-alt fa-fw"></i> <small>Paid:</small> <span id="statsPaid' +
    htmlSafeName +
    '">' +
    parseFloat(workerObj.paid || 0).toFixed(8) +
    "</span></div>";
  htmlToAdd += "</div></div></div>";

  // FIX: Use the correct container based on solo status
  var targetContainer = isSolo ? "#boxesSoloWorkers" : "#boxesPoolWorkers";
  var targetSection = isSolo ? "#soloWorkersSection" : "#poolWorkersSection";

  $(targetSection).show();
  $(targetContainer).append(htmlToAdd);
}

function rebuildWorkerDisplay() {
  $("#boxesPoolWorkers").html("");
  $("#boxesSoloWorkers").html("");
  $("#poolWorkersSection").hide();
  $("#soloWorkersSection").hide();

  var i = 0;

  // Display all workers, checking isSolo flag for each
  for (var w in statData.workers) {
    i++;
    var worker = statData.workers[w];
    var isSolo = worker.isSolo === true;
    var htmlSafeWorkerName =
      (isSolo ? "solo_" : "") +
      w
        .split(".")
        .join("_")
        .replace(/[^\w\s]/gi, "");
    var saneWorkerName = getWorkerNameFromAddress(w);
    addWorkerToDisplay(saneWorkerName, htmlSafeWorkerName, worker, isSolo);
  }
}

// resize chart on window resize
nv.utils.windowResize(triggerChartUpdates);

// grab initial stats
$.getJSON("/api/worker_stats?" + _miner, function (data) {
  statData = data;
  _workerCount = 0;
  for (var w in statData.workers) {
    _workerCount++;
  }

  buildChartData();
  displayCharts();
  rebuildWorkerDisplay();
  updateStats();
});

// live stat updates
if (window.statsSource) {
  statsSource.addEventListener("message", function (e) {
    if (document.hidden) return;

    // Fetch updated stats
    $.getJSON("/api/worker_stats?" + _miner, function (data) {
      statData = data;
      // check for missing workers
      var wc = 0;
      var rebuilt = false;

      // count all workers
      for (var w in statData.workers) {
        wc++;
      }

      if (_workerCount != wc) {
        if (_workerCount > wc) {
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
