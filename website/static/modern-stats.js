// Modern Pool Stats JS using Chart.js
var poolHashrateChart;
var poolPendingChart;
var pieCharts = {};
var statData = [];
var poolKeys = [];

// Chart.js default options
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// Destroy all existing charts
function destroyAllCharts() {
    if (poolHashrateChart) {
        poolHashrateChart.destroy();
        poolHashrateChart = null;
    }
    if (poolPendingChart) {
        poolPendingChart.destroy();
        poolPendingChart = null;
    }
    for (var pool in pieCharts) {
        if (pieCharts[pool]) {
            pieCharts[pool].destroy();
            delete pieCharts[pool];
        }
    }
}

// Initialize charts
function initCharts() {
    // Only destroy if we're re-initializing
    if (poolHashrateChart || poolPendingChart) {
        destroyAllCharts();
    }
    
    // Hashrate Chart
    const hashCtx = document.getElementById('poolHashrateChart');
    if (hashCtx && !poolHashrateChart) {
        poolHashrateChart = new Chart(hashCtx, {
            type: 'line',
            data: {
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 31, 46, 0.95)',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + getReadableHashRateString(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                hour: 'HH:mm',
                                minute: 'HH:mm'
                            }
                        },
                        grid: {
                            display: false
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            callback: function(value) {
                                return getReadableHashRateString(value);
                            }
                        }
                    }
                }
            }
        });
    }

    // Pending Blocks Chart
    const pendingCtx = document.getElementById('poolPendingChart');
    if (pendingCtx && !poolPendingChart) {
        poolPendingChart = new Chart(pendingCtx, {
            type: 'line',
            data: {
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 15,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 31, 46, 0.95)',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.y.toFixed(0) + ' blocks';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                hour: 'HH:mm',
                                minute: 'HH:mm'
                            }
                        },
                        grid: {
                            display: false
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });
    }
}

// Build chart data from API response - DO NOT DESTROY CHARTS
function buildChartData() {
    if (!statData || statData.length === 0) return;
    
    var pools = {};
    poolKeys = [];

    // Get all pool keys
    for (var i = 0; i < statData.length; i++) {
        for (var pool in statData[i].pools) {
            if (poolKeys.indexOf(pool) === -1) {
                poolKeys.push(pool);
            }
        }
    }

    // Build data for each pool
    for (var i = 0; i < statData.length; i++) {
        var time = statData[i].time * 1000;
        for (var f = 0; f < poolKeys.length; f++) {
            var pName = poolKeys[f];
            var a = pools[pName] = (pools[pName] || {
                hashrate: [],
                pending: []
            });
            
            if (pName in statData[i].pools) {
                a.hashrate.push({
                    x: time,
                    y: statData[i].pools[pName].hashrate
                });
                var totalPending = statData[i].pools[pName].blocks.pending || 0;
                a.pending.push({
                    x: time,
                    y: totalPending
                });
            } else {
                a.hashrate.push({
                    x: time,
                    y: 0
                });
                a.pending.push({
                    x: time,
                    y: 0
                });
            }
        }
    }

    // Prepare datasets for Chart.js
    var colors = [
        'rgb(59, 130, 246)',   // Blue
        'rgb(168, 85, 247)',   // Purple
        'rgb(16, 185, 129)',   // Green
        'rgb(245, 158, 11)',   // Orange
        'rgb(239, 68, 68)',    // Red
        'rgb(236, 72, 153)',   // Pink
    ];

    var hashDatasets = [];
    var pendingDatasets = [];
    var colorIndex = 0;

    for (var pool in pools) {
        var color = colors[colorIndex % colors.length];
        
        hashDatasets.push({
            label: pool.charAt(0).toUpperCase() + pool.slice(1),
            data: pools[pool].hashrate,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 5
        });

        pendingDatasets.push({
            label: pool.charAt(0).toUpperCase() + pool.slice(1),
            data: pools[pool].pending,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 5
        });

        // Update average hashrate
        var avgElement = document.getElementById('statsHashrateAvg' + pool);
        if (avgElement) {
            avgElement.textContent = getReadableHashRateString(calculateAverageHashrate(pool, pools[pool].hashrate));
        }
        
        colorIndex++;
    }

    // Update charts WITHOUT destroying them
    if (poolHashrateChart) {
        poolHashrateChart.data.datasets = hashDatasets;
        poolHashrateChart.update('none');
    }

    if (poolPendingChart) {
        poolPendingChart.data.datasets = pendingDatasets;
        poolPendingChart.update('none');
    }
}

// Calculate average hashrate
function calculateAverageHashrate(pool, data) {
    if (!data || data.length === 0) return 0;
    
    var sum = 0;
    for (var i = 0; i < data.length; i++) {
        sum += data[i].y;
    }
    return sum / data.length;
}

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

// Format hashrate string
function getReadableHashRateString(hashrate) {
    hashrate = (hashrate * 1000000);
    if (hashrate < 1000000) {
        return '0 H/s';
    }
    var byteUnits = [' H/s', ' KH/s', ' MH/s', ' GH/s', ' TH/s', ' PH/s', ' EH/s', ' ZH/s', ' YH/s'];
    var i = Math.floor((Math.log(hashrate / 1000) / Math.log(1000)) - 1);
    hashrate = (hashrate / 1000) / Math.pow(1000, i + 1);
    return hashrate.toFixed(2) + byteUnits[i];
}

// Format luck time
function getReadableLuckTime(lucktime) {
    var luck = parseFloat(lucktime);
    if (!lucktime || isNaN(luck) || !isFinite(luck)) return 'N/A';
    
    var timeUnits = [' Days', ' Hours', ' Minutes'];
    if (luck < 1) {
        luck = luck * 24;
        if (luck < 1) {
            luck = luck * 60;
            return luck < 0.01 ? '< 1 Minute' : luck.toFixed(2) + timeUnits[2];
        } else {
            return luck.toFixed(2) + timeUnits[1];
        }
    }
    return luck.toFixed(3) + timeUnits[0];
}

// Create pie charts for block finders - PRESERVE EXISTING
function createPieCharts() {
    // Track which pools we've already processed
    var processedPools = {};
    
    document.querySelectorAll('[id^="blocksPie"]').forEach(function(canvas) {
        var pool = canvas.id.replace('blocksPie', '');
        
        // Skip if we've already processed this pool AND chart exists
        if (processedPools[pool] || pieCharts[pool]) {
            return;
        }
        processedPools[pool] = true;
        
        // Check if the blockscomb variable exists for this pool
        var blocksData = window['blockscomb' + pool];
        
        if (!blocksData || blocksData.length === 0) {
            return;
        }
        
        // Group blocks by finder (using only address, not worker name)
        var groupedByFinder = {};
        for (var i = 0; i < blocksData.length; i++) {
            var fullFinder = blocksData[i][3];
            // Extract only the address part (before the dot)
            var finder = fullFinder.split('.')[0];
            if (!(finder in groupedByFinder)) {
                groupedByFinder[finder] = 0;
            }
            groupedByFinder[finder]++;
        }
        
        // Sort by count and limit to top 10
        var sorted = Object.entries(groupedByFinder)
            .sort(function(a, b) { return b[1] - a[1]; })
            .slice(0, 10);
        
        // Prepare data for Chart.js
        var labels = [];
        var data = [];
        var backgroundColors = [];
        var borderColors = [];
        var colors = [
            'rgba(59, 130, 246, 0.8)',   // Blue
            'rgba(168, 85, 247, 0.8)',   // Purple
            'rgba(16, 185, 129, 0.8)',   // Green
            'rgba(245, 158, 11, 0.8)',   // Orange
            'rgba(239, 68, 68, 0.8)',    // Red
            'rgba(236, 72, 153, 0.8)',   // Pink
            'rgba(34, 211, 238, 0.8)',   // Cyan
            'rgba(251, 191, 36, 0.8)',   // Yellow
            'rgba(163, 230, 53, 0.8)',   // Lime
            'rgba(100, 116, 139, 0.8)'   // Slate
        ];
        
        // Brighter versions for borders
        var borderColorsArray = [
            'rgb(59, 130, 246)',   // Blue
            'rgb(168, 85, 247)',   // Purple
            'rgb(16, 185, 129)',   // Green
            'rgb(245, 158, 11)',   // Orange
            'rgb(239, 68, 68)',    // Red
            'rgb(236, 72, 153)',   // Pink
            'rgb(34, 211, 238)',   // Cyan
            'rgb(251, 191, 36)',   // Yellow
            'rgb(163, 230, 53)',   // Lime
            'rgb(100, 116, 139)'   // Slate
        ];
        
        for (var i = 0; i < sorted.length; i++) {
            var finderName = sorted[i][0];
            var blockCount = sorted[i][1];
            
            // Truncate long addresses
            if (finderName.length > 20) {
                finderName = finderName.substr(0, 8) + '...' + finderName.substr(-4);
            }
            
            labels.push(finderName);
            data.push(blockCount);
            backgroundColors.push(colors[i % colors.length]);
            borderColors.push(borderColorsArray[i % borderColorsArray.length]);
        }
        
        // Only destroy and recreate if needed
        if (pieCharts[pool]) {
            pieCharts[pool].destroy();
        }
        
        // Create pie chart with improved visibility
        pieCharts[pool] = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 2,
                    hoverBorderWidth: 3,
                    hoverBorderColor: 'rgba(255, 255, 255, 0.8)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 20,
                            font: {
                                size: 14,
                                weight: '500'
                            },
                            color: '#e2e8f0',
                            generateLabels: function(chart) {
                                var data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    var dataset = data.datasets[0];
                                    var total = dataset.data.reduce(function(a, b) { return a + b; }, 0);
                                    return data.labels.map(function(label, i) {
                                        var value = dataset.data[i];
                                        var percentage = ((value / total) * 100).toFixed(1);
                                        return {
                                            text: label + ' (' + value + ' - ' + percentage + '%)',
                                            fillStyle: dataset.backgroundColor[i],
                                            strokeStyle: dataset.borderColor[i],
                                            lineWidth: 2,
                                            hidden: false,
                                            index: i,
                                            fontColor: '#e2e8f0'
                                        };
                                    });
                                }
                                return [];
                            }
                        },
                        onHover: function(event, legendItem, legend) {
                            canvas.style.cursor = legendItem ? 'pointer' : 'default';
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 31, 46, 0.95)',
                        titleColor: '#e2e8f0',
                        bodyColor: '#cbd5e1',
                        padding: 14,
                        cornerRadius: 8,
                        titleFont: {
                            size: 15,
                            weight: 'bold'
                        },
                        bodyFont: {
                            size: 13
                        },
                        callbacks: {
                            label: function(context) {
                                var label = context.label || '';
                                var value = context.parsed || 0;
                                var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                                var percentage = ((value / total) * 100).toFixed(1);
                                return label + ': ' + value + ' blocks (' + percentage + '%)';
                            }
                        }
                    }
                },
                animation: {
                    animateRotate: true,
                    animateScale: false,
                    duration: 1000
                }
            }
        });
    });
}

// Initial data load
function loadInitialData() {
    $.getJSON('/api/pool_stats', function(data) {
        // Ensure statData is always an array
        if (Array.isArray(data)) {
            statData = data;
        } else {
            statData = [];
        }
        buildChartData();

        // Delay pie chart creation to ensure blockscomb variables are defined
        setTimeout(createPieCharts, 500);
    }).fail(function() {
        console.error('Failed to load pool stats');
    });
}

function initPoolStats() {
    // Only initialize if we're on the stats page
    if (!document.querySelector('.stats-container')) {
        return;
    }

    // Prevent multiple initializations
    if (window.poolStatsInitialized) {
        console.log('Pool stats already initialized');
        return;
    }
    window.poolStatsInitialized = true;

    console.log('Initializing pool stats...');

    // Initialize charts (won't destroy if they don't exist)
    initCharts();

    // Load data
    loadInitialData();
}

// Initialize when document is ready
$(document).ready(function() {
    // Check if this is the stats page
    if (document.getElementById('poolHashrateChart') || document.getElementById('poolPendingChart')) {
        initPoolStats();
    }
});

// Make available for hot-swap
window.initStatsCharts = function() {
    // Reset initialization flag for hotswap
    window.poolStatsInitialized = false;
    initPoolStats();
};

// Live updates via global statsUpdate event - use the unified system from main.js
$(document).on('statsUpdate', function(event, stats) {
    if (document.hidden || !document.querySelector('.stats-container')) return;

    try {
        // Update stats displays
        for (var pool in stats.pools) {
            var poolStats = stats.pools[pool];

            $('#statsMiners' + pool).text(poolStats.minerCount);
            $('#statsWorkers' + pool).text(poolStats.workerCount);
            $('#statsHashrate' + pool).text(poolStats.hashrateString);
            $('#statsLuckDays' + pool).text(getReadableLuckTime(poolStats.luckDays));
            $('#statsTotalPaid' + pool).text((parseFloat(poolStats.poolStats.totalPaid)).toFixed(8));
            $('#statsNetworkBlocks' + pool).text(poolStats.poolStats.networkBlocks);
            $('#statsNetworkDiff' + pool).text(getReadableDifficultyString(poolStats.poolStats.networkDiff));
            $('#statsnetworkHash' + pool).text(poolStats.poolStats.networkHashString);
            $('#statsNetworkConnections' + pool).text(poolStats.poolStats.networkConnections);

            var percent = poolStats.hashrate / poolStats.poolStats.networkHash * 100;
            $('#statsHashPercent' + pool).text(percent.toFixed(5) + '%');

            // Update block counts
            var totalBlocks = poolStats.blocks.pending + poolStats.blocks.confirmed;
            $('#statsValidBlocks' + pool).text(totalBlocks);

            var poolBlocks = poolStats.poolBlocks.pending + poolStats.poolBlocks.confirmed;
            var soloBlocks = (poolStats.soloBlocks ? (poolStats.soloBlocks.pending || 0) + (poolStats.soloBlocks.confirmed || 0) : 0);
            $('#statsPoolBlocks' + pool).text(poolBlocks);
            if (soloBlocks > 0) {
                $('#statsSoloBlocks' + pool).text(soloBlocks);
            }
        }

        // Add new data point to charts WITHOUT DESTROYING THEM
        statData.push(stats);
        if (statData.length > 100) statData.shift(); // Keep last 100 points

        // Check if new pool added
        var newPoolAdded = false;
        for (var p in stats.pools) {
            if (poolKeys.indexOf(p) === -1) {
                newPoolAdded = true;
                break;
            }
        }

        if (newPoolAdded) {
            buildChartData();
        } else {
            // Update existing chart data IN PLACE
            var time = stats.time * 1000;

            if (poolHashrateChart && poolHashrateChart.data.datasets) {
                poolHashrateChart.data.datasets.forEach(function(dataset) {
                    var poolName = dataset.label.toLowerCase();
                    if (poolName in stats.pools) {
                        dataset.data.push({
                            x: time,
                            y: stats.pools[poolName].hashrate
                        });
                        if (dataset.data.length > 100) dataset.data.shift();
                    }
                });
                poolHashrateChart.update('none');
            }

            if (poolPendingChart && poolPendingChart.data.datasets) {
                poolPendingChart.data.datasets.forEach(function(dataset) {
                    var poolName = dataset.label.toLowerCase();
                    if (poolName in stats.pools) {
                        dataset.data.push({
                            x: time,
                            y: stats.pools[poolName].blocks.pending || 0
                        });
                        if (dataset.data.length > 100) dataset.data.shift();
                    }
                });
                poolPendingChart.update('none');
            }
        }
    } catch (err) {
        console.error('Error processing stats update:', err);
    }
});

// FIXED: Stats page initialization with proper menu handling
(function() {
    function initStatsPage() {
        console.log('Initializing stats page...');
        
        // CRITICAL: Re-setup mobile menu functionality after hot-swap
        // The menu handlers get lost when the page content is replaced
        if (window.toggleMenu) {
            // Ensure menu toggle button works
            $('.menu-toggle').off('click.statsPage').on('click.statsPage', function(e) {
                e.preventDefault();
                e.stopPropagation();
                window.toggleMenu();
                return false;
            });
        }
        
        // Initialize charts
        if (typeof window.initStatsCharts === 'function') {
            window.initStatsCharts();
        }
    }
    
    // Register for hot-swap
    window.initStatsScripts = function() {
        // Small delay to ensure DOM is ready
        setTimeout(initStatsPage, 100);
    };
    
    // Initialize on DOM ready if directly loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStatsPage);
    } else {
        initStatsPage();
    }
})();

// Cleanup function - DO NOT destroy charts unnecessarily
window.addEventListener('beforeunload', function() {
    destroyAllCharts();
});