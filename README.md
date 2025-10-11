# SHA256-NOMP - Node Open Mining Portal
[![GitHub CI](https://github.com/janos-raul/sha256-nomp/actions/workflows/node.js.yml/badge.svg)](https://github.com/janos-raul/sha256-nomp/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is a SHA256 mining pool with solo mining support and ASICBoost with version rolling, based on Node Open Mining Portal.
  
#### Production Usage Notice
This is beta software. All of the following are things that can change and break an existing SHA256-NOMP setup: functionality of any feature, structure of configuration files and structure of redis data. If you use this software in production then *DO NOT* pull new code straight into production usage because it can and often will break your setup and require you to tweak things like config files or redis data. *Only tagged releases are considered stable.*

#### Paid Solution
Usage of this software requires abilities with sysadmin, database admin, coin daemons, and sometimes a bit of programming. Running a production pool can literally be more work than a full-time job.

### Features

* ✅ **Solo Mining Support** - Miners can mine solo with `m=solo` password parameter
* ✅ **ASICBoost Support** - Full support with version rolling for mining optimization
* ✅ **Fixed Payment System** - Resolved double fee deduction issue (v1.4.1)
* ✅ **Multiple Payment Modes** - PROP and PPLNT payment systems
* ✅ **Dual Mining** - Support pool and solo mining simultaneously

### Recent Updates (v1.4.4)

* **UPDATE**: Security enhancements
* **Fixed**: Memory optimization

### Recent Updates (v1.4.3)

* **UPDATE**: Added Whatsminer support

### Recent Updates (v1.4.2)

* **UPDATE**: Updated package.json dependencies
* **FIXED**: Logging and added log rotation, log archive 

### Recent Updates (v1.4.1)

* **FIXED**: Double fee deduction bug in solo mining payment processing
* **IMPROVED**: Solo mining fees now correctly compensate for coinbase rewardRecipients
* **ENHANCED**: Consistent fee handling for both 'generate' and 'immature' blocks
* **OPTIMIZED**: Payment processor efficiency improvements

### Supported Coins

SHA256-NOMP comes pre-configured with the following coins:

| Coin | Symbol | Algorithm | Ports | Min Confirmations | Block Time |
|------|--------|-----------|-------|-------------------|------------|
| Bitcoin | BTC | SHA256 | 50212-50216 | 101 | 10 min |
| Bitcoin Silver | BTCS | SHA256 | 50220-50226 | 201 | 5 min |
| Mytherra | MYT | SHA256 | 50232-50236 | 101 | 5 min |
| Bitcoin II | BC2 | SHA256 | 50242-50246 | 101 | 10 min |

All coins support:
- ✅ ASICBoost with version rolling
- ✅ SegWit and Taproot
- ✅ Solo and pool mining modes
- ✅ Variable difficulty per port
- ✅ Multiple mining ports for different hashrates

### Community

If your pool uses SHA256-NOMP let us know and we will list your website here.

### Some pools using SHA256-NOMP:

* [sha256-mining.go.ro - Mining Pool](https://sha256-mining.go.ro:50300)

* [UGPOOL.lol - Mining Pool](https://ugpool.lol/)

Usage
=====

#### Requirements
* Coin daemon(s) (find the coin's repo and build latest version from source)
* [Node.js](http://nodejs.org/) v16+ ([follow these installation instructions](https://github.com/joyent/node/wiki/Installing-Node.js-via-package-manager))
* [Redis](http://redis.io/) key-value store v2.6+ ([follow these instructions](http://redis.io/topics/quickstart))

##### Seriously
Those are legitimate requirements. If you use old versions of Node.js or Redis that may come with your system package manager then you will have problems. Follow the linked instructions to get the last stable versions.

[**Redis security warning**](http://redis.io/topics/security): be sure firewall access to redis - an easy way is to
include `bind 127.0.0.1` in your `redis.conf` file. Also it's a good idea to learn about and understand software that
you are using - a good place to start with redis is [data persistence](http://redis.io/topics/persistence).

#### 0) Setting up coin daemon
Follow the build/install instructions for your coin daemon. Your coin.conf file should end up looking something like this:
```
daemon=1
rpcuser=username
rpcpassword=password
rpcport=8332
```
For redundancy, its recommended to have at least two daemon instances running in case one drops out-of-sync or offline,
all instances will be polled for block/transaction updates and be used for submitting blocks. Creating a backup daemon
involves spawning a daemon using the `-datadir=/backup` command-line argument which creates a new daemon instance with
it's own config directory and coin.conf file. Learn about the daemon, how to use it and how it works if you want to be
a good pool operator. For starters be sure to read:
   * https://en.bitcoin.it/wiki/Running_bitcoind
   * https://en.bitcoin.it/wiki/Data_directory
   * https://en.bitcoin.it/wiki/Original_Bitcoin_client/API_Calls_list
   * https://en.bitcoin.it/wiki/Difficulty

#### 1) Downloading & Installing

Clone the repository and run `npm install` for all the dependencies to be installed:

```bash
sudo apt-get install build-essential libsodium-dev libboost-all-dev libgmp3-dev node-gyp libssl-dev -y
sudo apt install nodejs npm -y
sudo npm install n -g
sudo n stable
sudo apt purge nodejs npm -y
git clone https://github.com/janos-raul/sha256-nomp
cd sha256-nomp
npm install
```

#### 2) Configuration

SHA256-NOMP uses three types of configuration files:
- **config.json** - Main portal configuration
- **coins/*.json** - Coin-specific configurations (blockchain settings)
- **pool_configs/*.json** - Pool operational configurations (ports, fees, payments)

##### Portal config
Inside the `config_example.json` file, ensure the default configuration will work for your environment, then copy the file to `config.json`.

Explanation for each field:
````javascript
{
    /* Specifies the level of log output verbosity. Anything more severe than the level specified
       will also be logged. */
    "logLevel": "debug", //or "warning", "error"
    
    /* By default the server logs to console and gives pretty colors. If you direct that output to a
       log file then disable this feature to avoid nasty characters in your log file. */
    "logColors": true, 

    /* The server CLI (command-line interface) will listen for commands on this port. For example,
       blocknotify messages are sent to the server through this. */
    "cliPort": 17117,

    /* By default 'forks' is set to "auto" which will spawn one process/fork/worker for each CPU
       core in your system. Each of these workers will run a separate instance of your pool(s),
       and the kernel will load balance miners using these forks. Optionally, the 'forks' field
       can be a number for how many forks will be spawned. */
    "clustering": {
        "enabled": true,
        "forks": "auto"
    },
    
    /* Pool config file will inherit these default values if they are not set. */
    "defaultPoolConfigs": {
    
        /* Poll RPC daemons for new blocks every this many milliseconds. */
        "blockRefreshInterval": 1000,
        
        /* If no new blocks are available for this many seconds update and rebroadcast job. */
        "jobRebroadcastTimeout": 55,
        
        /* Disconnect workers that haven't submitted shares for this many seconds. */
        "connectionTimeout": 600,
        
        /* (For MPOS mode) Store the block hashes for shares that aren't block candidates. */
        "emitInvalidBlockHashes": false,
        
        /* This option will only authenticate miners using an address or mining key. */
        "validateWorkerUsername": true,
        
        /* Enable for client IP addresses to be detected when using a load balancer with TCP
           proxy protocol enabled, such as HAProxy with 'send-proxy' param:
           http://haproxy.1wt.eu/download/1.5/doc/configuration.txt */
        "tcpProxyProtocol": false,
        
        /* If under low-diff share attack we can ban their IP to reduce system/network load. If
           running behind HAProxy be sure to enable 'tcpProxyProtocol', otherwise you'll end up
           banning your own IP address (and therefore all workers). */
        "banning": {
            "enabled": true,
            "time": 600, //How many seconds to ban worker for
            "invalidPercent": 50, //What percent of invalid shares triggers ban
            "checkThreshold": 500, //Perform check when this many shares have been submitted
            "purgeInterval": 300 //Every this many seconds clear out the list of old bans
        },
        
        /* Used for storing share and block submission data and payment processing. */
        "redis": {
            "host": "127.0.0.1",
            "port": 6379
        }
    },

    /* This is the front-end. Its not finished. When it is finished, this comment will say so. */
    "website": {
        "enabled": true,
        /* If you are using a reverse-proxy like nginx to display the website then set this to
           127.0.0.1 to not expose the port. */
        "host": "0.0.0.0",
        "port": 80,
        /* Used for displaying stratum connection data on the Getting Started page. */
        "stratumHost": "yourpool.com",
        "stats": {
            /* Gather stats to broadcast to page viewers and store in redis for historical stats
               every this many seconds. */
            "updateInterval": 15,
            /* How many seconds to hold onto historical stats. Currently set to 24 hours. */
            "historicalRetention": 43200,
            /* How many seconds worth of shares should be gathered to generate hashrate. */
            "hashrateWindow": 300
        },
        /* Not done yet. */
        "adminCenter": {
            "enabled": true,
            "password": "password"
        }
    },

    /* Redis instance of where to store global portal data such as historical stats, proxy states,
       ect.. */
    "redis": {
        "host": "127.0.0.1",
        "port": 6379
    },

    /* With this switching configuration, you can setup ports that accept miners for work based on
       a specific algorithm instead of a specific coin. */
    "switching": {
        "switch1": {
            "enabled": false,
            "algorithm": "sha256",
            "ports": {
                "3333": {
                    "diff": 10,
                    "varDiff": {
                        "minDiff": 16,
                        "maxDiff": 512,
                        "targetTime": 15,
                        "retargetTime": 90,
                        "variancePercent": 30
                    }
                }
            }
        }
    },
}
````

##### Coin config
Inside the `coins` directory, ensure a json file exists for your coin. The coin configuration defines blockchain-specific settings and daemon connection parameters.

**Available Coins:**
- `bitcoin.json` - Bitcoin (BTC)
- `bitcoinsilver.json` - Bitcoin Silver (BTCS)
- `mytherra.json` - Mytherra (MYT)
- `bitcoinii.json` - Bitcoin II (BC2)

**Coin Configuration Fields:**
````javascript
{
    // Basic coin information
    "name": "bitcoin",
    "symbol": "BTC",
    "algorithm": "sha256",
    "reward": "POW",

    // ASICBoost configuration
    "asicboost": true,                    // Enable ASICBoost with version rolling
    "versionMask": "0x3fffe000",          // Version mask for ASICBoost
    "enforcePoolVersionMask": true,       // Enforce version mask
    "versionRollingMinBits": 16,          // Minimum bits for version rolling
    "asicboostMinDifficulty": 1000,       // Minimum difficulty for ASICBoost
    "asicboostMaxClients": 1000,          // Maximum ASICBoost clients

    // Coinbase and transaction settings
    "coinbase": "yourpool.com",           // Coinbase signature (pool identifier)
    "txMessages": false,                  // Enable transaction messages
    "segwit": true,                       // Enable SegWit support
    "taproot": true,                      // Enable Taproot support
    "coinbaseTxVersion": 2,               // Coinbase transaction version
    "hasBlockReward": true,               // Coin has block reward
    "blockVersion": 536870912,            // Block version number
    "default_witness_commitment": true,   // Include witness commitment
    "shareDifficultyTarget": "target",    // Share difficulty calculation method

    // Network and timing settings
    "rpcTimeout": 5000,                   // RPC timeout in milliseconds
    "blockTime": 600,                     // Expected block time in seconds
    "minConf": 101,                       // Minimum confirmations for payouts

    // Address validation (prevents invalid addresses)
    "addressValidation": {
        "validateWorkerUsername": true,   // Validate miner addresses
        "addressPrefix": "bc",            // Expected address prefix (bc for BTC, bs for BTCS, myt for MYT)
        "minLength": 26,                  // Minimum address length
        "maxLength": 46                   // Maximum address length
    },

    // Block explorer URLs
    "explorer": {
        "txURL": "https://blockstream.info/tx/",      // Transaction explorer URL
        "blockURL": "https://blockstream.info/block/" // Block explorer URL
    },

    // RPC daemon connection (used by blockConfirmations.js and other utilities)
    "rpc": {
        "host": "127.0.0.1",              // Daemon host
        "port": 8332,                     // Daemon RPC port
        "user": "rpcuser",                // RPC username
        "password": "rpcpassword"         // RPC password
    }
}
````

**Important Notes:**
- The `minConf` value determines how many confirmations are required before blocks are paid out
- Bitcoin typically uses 101 confirmations, Bitcoin Silver uses 201
- ASICBoost is enabled by default for optimal performance with modern ASIC miners
- The `rpc` section is used by maintenance scripts like `blockConfirmations.js`

##### Pool config
Pool configurations define operational settings for each coin's mining pool. Each coin has its own pool config file in `pool_configs/`.

**Available Pool Configurations:**
- `pool_configs/bitcoin.json` - Bitcoin pool (ports 50212-50216)
- `pool_configs/bitcoinsilver.json` - Bitcoin Silver pool (ports 50220-50226)
- `pool_configs/mytherra.json` - Mytherra pool (ports 50232-50236)
- `pool_configs/bitcoinii.json` - Bitcoin II pool (ports 50242-50246)

**Pool Configuration Structure:**

```javascript
{
    // Basic settings
    "enabled": true,                      // Enable this pool
    "coin": "bitcoin.json",              // Reference to coin config file
    "asicboost": true,                   // Enable ASICBoost for this pool
    "blockIdentifier": "",               // Optional block identifier
	
	  // ============================================================================
	  // SECURITY MODULE - Advanced DDoS Protection & Rate Limiting
	  // ============================================================================

	  "security": {
		"enabled": true,                    // Master switch for security features

		// Rate Limiting Configuration
		// Tracks and limits connection attempts, malformed messages, and floods per IP
		"rateLimit": {
		  "enabled": true,                  // Enable rate limiting
		  "window": 60000,                  // Time window in ms (60000 = 1 minute)
		  "maxConnections": 10,             // Max connections per IP per window
		  "maxMalformed": 3,                // Max malformed messages before ban
		  "maxFloods": 2                    // Max socket flood detections before ban
		},

		// Auto-Ban System Configuration
		// Progressive ban system with escalating durations based on strikes
		"ban": {
		  "enabled": true,                  // Enable automatic IP banning
		  "duration": 600000,               // Initial ban duration in ms (600000 = 10 minutes)
		  "maxStrikes": 3,                  // Number of strikes before permanent ban
		  "permanentDuration": 86400000     // Permanent ban duration in ms (86400000 = 24 hours)
		}
	  },

    // Pool wallet and fee addresses
    "address": "YOUR_POOL_WALLET_ADDRESS",    // Main pool payout address

    "rewardRecipients": {
        // IMPORTANT: This is a COINBASE-LEVEL split, deducted BEFORE poolFee/soloFee!
        // If you set this > 0, it reduces the block reward available for fee calculation
        // Example: 6.25 BTC block with 1.0% here = 0.0625 BTC to fee address at coinbase
        //          Remaining 6.1875 BTC is then split by poolFee/soloFee percentages
        // RECOMMENDED: Set to 0.0 and use poolFee/soloFee instead for simpler accounting
        "YOUR_FEE_ADDRESS": 0.0          // Coinbase reward split (0.0 = disabled, recommended)
    },

    // Payment processing configuration
    "paymentProcessing": {
        "txfee": 0.0004,                 // Transaction fee for payouts
        "minConf": 101,                  // Confirmations before payment (must match coin config)
        "enabled": true,                 // Enable automatic payments
        "soloMining": true,              // Enable solo mining mode
        "paymentMode": "prop",           // Payment mode: "prop" or "pplnt"
        "poolFee": 2.0,                  // Pool mining fee (2.0 = 2%) - applied AFTER rewardRecipients
        "soloFee": 2.0,                  // Solo mining fee (2.0 = 2%) - applied AFTER rewardRecipients
        "paymentInterval": 3600,         // Payment interval in seconds (3600 = 1 hour)
        "minimumPayment": 0.01,          // Minimum payout for pool miners
        "minimumPayment_solo": 0.01,     // Minimum payout for solo miners
        "maxBlocksPerPayment": 5,        // Maximum blocks to process per payment run

        // Payment daemon connection
        "daemon": {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "rpcuser",
            "password": "rpcpassword"
        }
    },

    // TLS/SSL configuration (optional)
    "tlsOptions": {
        "enabled": false,
        "serverKey": "",
        "serverCert": "",
        "ca": ""
    },

    // Mining ports configuration
    "ports": {
        "50212": {                       // Port number
            "diff": 25000,               // Starting difficulty
            "tls": false,                // Enable TLS for this port
            "soloMining": true,          // Allow solo mining on this port
            "varDiff": {                 // Variable difficulty settings
                "minDiff": 10000,        // Minimum difficulty
                "maxDiff": 500000,       // Maximum difficulty
                "targetTime": 15,        // Target time between shares (seconds)
                "retargetTime": 90,      // How often to adjust difficulty (seconds)
                "variancePercent": 30    // Allowed variance percentage
            }
        },
        "50213": {                       // Higher difficulty port for larger miners
            "diff": 50000,
            "tls": false,
            "soloMining": true,
            "varDiff": {
                "minDiff": 50000,
                "maxDiff": 5000000,
                "targetTime": 25,
                "retargetTime": 180,
                "variancePercent": 35
            }
        }
    },

    // Pool identifier for multi-region setups
    "poolId": "main",

    // Daemon instances for block submission and monitoring
    "daemons": [
        {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "rpcuser",
            "password": "rpcpassword"
        }
    ],

    // P2P block notifications (optional, alternative to blocknotify)
    "p2p": {
        "enabled": false,
        "host": "127.0.0.1",
        "port": 8333,
        "disableTransactions": true
    },

    // MPOS database integration (optional)
    "mposMode": {
        "enabled": false,
        "host": "127.0.0.1",
        "port": 3306,
        "user": "",
        "password": "",
        "database": "",
        "checkPassword": true,
        "autoCreateWorker": false
    }
}
```

**Difficulty Notes:**
> **Important:** Pool difficulty is NOT the same as network difficulty!
> - 1.0 pool difficulty = 8192 network difficulty
> - 0.125 pool difficulty = 1024 network difficulty
>
> When miners submit shares, the pool accumulates the difficulty:
> - Miner 1 at 0.1 difficulty finding 10 shares = 1 accumulated share
> - Miner 2 at 0.5 difficulty finding 5 shares = 2.5 accumulated shares

**Payment Modes:**
- **PROP (Proportional)**: Miners are paid proportionally to their shares when a block is found
- **PPLNT (Pay Per Last N Time)**: Payment based on shares in the last N time window

**Port Configuration Strategy:**
Each coin has multiple ports with different difficulty ranges:
- Low difficulty ports (e.g., 50212): For small miners and testing
- Medium difficulty ports (e.g., 50213): For medium-sized miners
- High difficulty ports (e.g., 50214): For large mining operations
- Very high difficulty ports (e.g., 50216): For massive mining farms

**Fee Structure - IMPORTANT:**

Understanding how fees work is crucial for proper pool operation:

1. **rewardRecipients** (Coinbase-level split):
   - Deducted directly from block reward at coinbase transaction creation
   - Happens BEFORE any other fee calculations
   - Example with 6.25 BTC block and 1.0% rewardRecipients:
     - 0.0625 BTC goes to fee address immediately
     - Remaining 6.1875 BTC available for pool/solo fee calculations
   - **CAUTION**: Using this complicates fee accounting!
   - **RECOMMENDED**: Set to 0.0 and use poolFee/soloFee instead

2. **poolFee** (Pool mining fee):
   - Applied to pool miners AFTER rewardRecipients deduction
   - Percentage taken from remaining block reward
   - Simple and transparent for miners
   - Example with 2.0% poolFee on 6.25 BTC block (no rewardRecipients):
     - Pool takes: 0.125 BTC
     - Miners share: 6.125 BTC

3. **soloFee** (Solo mining fee):
   - Applied to solo miners AFTER rewardRecipients deduction
   - Solo miner receives entire block minus this fee
   - Example with 2.0% soloFee on 6.25 BTC block (no rewardRecipients):
     - Pool takes: 0.125 BTC
     - Solo miner receives: 6.125 BTC

**Best Practice Fee Configuration:**
```javascript
"rewardRecipients": {
    "YOUR_FEE_ADDRESS": 0.0   // Keep at 0.0 for simplicity
},
"paymentProcessing": {
    "poolFee": 2.0,           // Your pool fee percentage
    "soloFee": 2.0            // Your solo mining fee percentage
}
```

This approach keeps accounting simple and transparent for your miners.

#### Solo Mining Configuration

Miners connect for solo mining using the password parameter:
```
Username: YOUR_BITCOIN_ADDRESS
Password: m=solo
```

Example connections:
* **CGMiner**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo`
* **With custom difficulty**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo,d=65536`

##### [Optional, recommended] Setting up blocknotify
1. In `config.json` set the port and password for `blockNotifyListener`
2. In your daemon conf file set the `blocknotify` command to use:
```
node [path to cli.js] [coin name in config] [block hash symbol]
```
Example: inside `bitcoin.conf` add the line
```
blocknotify=node /home/user/sha256-nomp/scripts/cli.js blocknotify bitcoin %s
```

Alternatively, you can use a more efficient block notify script written in pure C. Build and usage instructions
are commented in [scripts/blocknotify.c](scripts/blocknotify.c).

#### 3) Block Confirmation Monitoring

SHA256-NOMP includes a utility script for monitoring block confirmations: `libs/blockConfirmations.js`

##### What is blockConfirmations.js?

This script checks the confirmation status of pending blocks (both pool and solo) and updates their status in Redis. It's useful for:
- Monitoring block maturity before payouts
- Detecting orphaned blocks
- Tracking confirmation progress
- Debugging payment issues

##### How blockConfirmations.js Works

The script performs the following steps:

1. **Connects to Redis** - Reads pending blocks from the pool's Redis database
2. **Queries Coin Daemons** - Checks each pending block against the blockchain via RPC
3. **Updates Confirmations** - Records the current confirmation count for each block
4. **Detects Orphans** - Identifies blocks that are no longer in the main chain
5. **Generates Report** - Provides detailed statistics about block status

##### Using blockConfirmations.js - Step by Step

**Step 1: Configure the Script**

Edit `libs/blockConfirmations.js` and update the `poolConfigs` object with your coin configurations:

```javascript
const poolConfigs = {
    bitcoin: {
        daemon: {
            host: "127.0.0.1",
            port: 8332,
            user: "rpcuser",
            password: "rpcpassword"
        },
        minConfirmations: 101  // Must match your pool config minConf
    },
    bitcoinsilver: {
        daemon: {
            host: "127.0.0.1",
            port: 10013,
            user: "rpcuser",
            password: "rpcpassword"
        },
        minConfirmations: 201
    }
    // Add more coins as needed
};
```

**Step 2: Ensure Redis is Running**

The script requires Redis to be running and accessible:

```bash
redis-cli ping
# Should return: PONG
```

**Step 3: Run the Script**

Execute the script from the pool's root directory:

```bash
node libs/blockConfirmations.js
```

**Step 4: Interpret the Output**

The script provides detailed output:

```
[SPECIAL] [BlockConfirm] [Init] === Block Confirmation Tracker Started ===
[INFO] [BlockConfirm] [Init] Checking confirmations for: bitcoin, bitcoinsilver, mytherra
[INFO] [BlockConfirm] [bitcoin] Starting block confirmation check...
[INFO] [BlockConfirm] [bitcoin] Found 3 pending pool blocks
[INFO] [BlockConfirm] [bitcoin] POOL block 850123: 45/101 confirmations
[INFO] [BlockConfirm] [bitcoin] POOL block 850124: 23/101 confirmations
[SPECIAL] [BlockConfirm] [bitcoin] POOL block 850100 CONFIRMED! 101/101 confirmations
[INFO] [BlockConfirm] [bitcoin] Found 1 pending SOLO blocks
[SPECIAL] [BlockConfirm] [bitcoin] ★ SOLO block 850095 by bc1q...xyz CONFIRMED! 120/101 confirmations
[WARNING] [BlockConfirm] [bitcoin] POOL block 850050 ORPHANED!
[SPECIAL] [BlockConfirm] [Summary] === Confirmation Check Complete ===
[INFO] [BlockConfirm] [Summary] Runtime: 1247ms
[INFO] [BlockConfirm] [Summary] Pool blocks: 3 (Confirmed: 1)
[INFO] [BlockConfirm] [Summary] Solo blocks: 1 (Confirmed: 1)
[WARNING] [BlockConfirm] [Summary] Orphaned blocks detected: 1
```

**Step 5: Automate with Cron (Optional)**

For regular monitoring, add to your crontab:

```bash
# Check block confirmations every 10 minutes
*/10 * * * * cd /path/to/sha256-nomp && /usr/bin/node libs/blockConfirmations.js >> logs/block-confirmations.log 2>&1
```

##### Understanding Block Confirmations

**What are confirmations?**
- Each new block added to the blockchain after your block counts as one confirmation
- Confirmations make blocks more secure and less likely to be orphaned
- Most pools require 101-201 confirmations before paying out miners

**Block States:**
- **Pending**: Block found but not yet confirmed (0 - minConf confirmations)
- **Confirmed**: Block has reached required confirmations (≥ minConf)
- **Orphaned**: Block no longer in the main chain (confirmations = -1)

**Why blocks get orphaned:**
- Another miner found a competing block at the same height
- Network propagation delays
- Chain reorganizations

**Confirmation Requirements by Coin:**
- Bitcoin (BTC): 101 confirmations (~16.8 hours)
- Bitcoin Silver (BTCS): 201 confirmations (~16.8 hours, 5 min blocks)
- Mytherra (MYT): 101 confirmations (~8.4 hours, 5 min blocks)
- Bitcoin II (BC2): 101 confirmations (~16.8 hours)

##### Troubleshooting

**Script can't connect to Redis:**
```bash
# Check if Redis is running
sudo systemctl status redis

# Start Redis if needed
sudo systemctl start redis
```

**RPC connection errors:**
- Verify daemon is running and synced
- Check RPC credentials in blockConfirmations.js
- Ensure firewall allows RPC connections
- Verify RPC port is correct for each coin

**No pending blocks found:**
- Normal if no recent blocks were found
- Check that pool has been running and miners are connected
- Verify Redis contains block data: `redis-cli keys "*blocksPending*"`

#### 4) Start the portal

```bash
npm start
```

###### Optional enhancements for your awesome new mining pool server setup:
* Use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
in case the master process crashes.
* Use something like [redis-commander](https://github.com/joeferner/redis-commander) to have a nice GUI
for exploring your redis database.
* Use something like [logrotator](http://www.thegeekstuff.com/2010/07/logrotate-examples/) to rotate log
output from SHA256-NOMP.
* Use [New Relic](http://newrelic.com/) to monitor your SHA256-NOMP instance and server performance.

#### Upgrading SHA256-NOMP
When updating SHA256-NOMP to the latest code its important to not only `git pull` the latest from this repo, but to also update
the `node-stratum-pool` and `node-multi-hashing` modules, and any config files that may have been changed.
* Inside your SHA256-NOMP directory (where the init.js script is) do `git pull` to get the latest SHA256-NOMP code.
* Remove the dependencies by deleting the `node_modules` directory with `rm -r node_modules`.
* Run `npm update` to force updating/reinstalling of the dependencies.
* Compare your `config.json` and `pool_configs/coin.json` configurations to the latest example ones in this repo or the ones in the setup instructions where each config field is explained. <b>You may need to modify or add any new changes.</b>

Donations
-------
Donations for development are greatly appreciated!

* BTC:  `bc1q0aa3k39ww33z24p3wpk72jjn32h2n5rfr85pnx`
* BTCS: `bs1q8dnz4q52czdusl8hy04fw3jryj2kc3earck3y2`
* BCH:  `qzhpajyfz7yvl8963rre5zqdp72pqy47ysttst0wmr`

Credits
-------
### SHA256-NOMP
* [Janos-Raul](https://github.com/janos-raul) - maintainer, fixed payment processing

### ZNY-NOMP (Original Fork Base)
* [ROZ](https://github.com/ROZ-MOFUMOFU-ME)
* [zinntikumugai](https://github.com/zinntikumugai)

### cryptocurrency-stratum-pool
* [Invader444](//github.com/Invader444)

### S-NOMP
* [egyptianbman](https://github.com/egyptianbman)
* [nettts](https://github.com/nettts)
* [potato](https://github.com/zzzpotato)

### K-NOMP
* [yoshuki43](https://github.com/yoshuki43)

### Z-NOMP
* [Joshua Yabut / movrcx](https://github.com/joshuayabut)
* [Aayan L / anarch3](https://github.com/aayanl)
* [hellcatz](https://github.com/hellcatz)

### NOMP
* [Matthew Little / zone117x](https://github.com/zone117x) - developer of NOMP
* [Jerry Brady / mintyfresh68](https://github.com/bluecircle) - got coin-switching fully working and developed proxy-per-algo feature
* [Tony Dobbs](http://anthonydobbs.com) - designs for front-end and created the NOMP logo
* [LucasJones](//github.com/LucasJones) - got p2p block notify working and implemented additional hashing algos
* [vekexasia](//github.com/vekexasia) - co-developer & great tester
* [TheSeven](//github.com/TheSeven) - answering an absurd amount of my questions and being a very helpful gentleman
* [UdjinM6](//github.com/UdjinM6) - helped implement fee withdrawal in payment processing
* [Alex Petrov / sysmanalex](https://github.com/sysmanalex) - contributed the pure C block notify script
* [svirusxxx](//github.com/svirusxxx) - sponsored development of MPOS mode
* [icecube45](//github.com/icecube45) - helping out with the repo wiki
* [Fcases](//github.com/Fcases) - ordered me a pizza <3
* Those that contributed to [node-stratum-pool](//github.com/zone117x/node-stratum-pool#credits)

License
-------
Released under the MIT License. See LICENSE file.