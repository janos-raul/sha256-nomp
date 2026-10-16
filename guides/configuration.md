# Configuration

Back to the [README](../README.md).

SHA256-NOMP uses three types of configuration files:

- **config.json** - Main portal configuration
- **coins/\*.json** - Coin-specific configurations (blockchain settings)
- **pool_configs/\*.json** - Pool operational configurations (ports, fees, payments)

## Portal config

Inside the `config_example.json` file, ensure the default configuration will work for your environment, then copy the file to `config.json`.

Explanation for each field:

```javascript
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
           127.0.0.1 to not expose the port, and let the proxy do TLS (tlsOptions.enabled false).
           The portal trusts X-Forwarded-For only from the same machine, so the proxy should set
           it to the client address ("proxy_set_header X-Forwarded-For $remote_addr;"), and
           /api/live_stats needs "proxy_buffering off" (server-sent events). */
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
        /* Optional: pool name and images shown by the website. Every field can be left out. */
        "branding": {
            "poolName": "SHA256 Mining Pool",   // header, page title, share previews
            "tagline": "Modern, Fast, Reliable",
            "logo": "/static/logo.png",         // header logo (default: built-in hexagon)
            "heroLogo": "/static/hero.png",     // large image on the home page (default: logo)
            "heroText": "Professional mining pool with low fees, reliable payouts, and 24/7 uptime",
            "ogImage": "https://yourpool.com/static/og.png", // Discord/Twitter preview image
            "ogImageAlt": "Your pool - solo and merged mining", // alt text for the preview image (default: name - tagline)
            "url": "https://yourpool.com",
            /* CoinGecko coin ids for the price ticker, comma separated */
            "priceCoins": "bitcoin,ethereum,ripple,binancecoin,solana,cardano,tron,litecoin,dogecoin"
        },
        /* Admin Center - Web-based pool administration panel */
        "adminCenter": {
            "enabled": true,
            "passwordHash": "$2a$10$YourBcryptHashHere..."  // Use generate-password-hash.js
        }
    },

    /* Redis instance of where to store global portal data such as historical stats, etc. */
    "redis": {
        "host": "127.0.0.1",
        "port": 6379
    }
}
```

## Coin config

Inside the `coins` directory, ensure a json file exists for your coin. The coin configuration defines blockchain-specific settings and daemon connection parameters.

**Available Coins:**

- `bitcoin.json` - Bitcoin (BTC)
- `bitcoinsilver.json` - Bitcoin Silver (BTCS)
- `bitcoingold.json` - Bitcoin Gold (BTGS)
- `mytherra.json` - Mytherra (MYT)
- `bitcoinii.json` - Bitcoin II (BC2)
- `sha256coin.json` - SHA256COIN (S256)

**Coin Configuration Fields:**

```javascript
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
    "coinbasePayouts": {
        "enabled": false,                  // Master switch for coinbase payout controls
        "coinbaseOnly": false,             // If true, payment txs spend only generated (coinbase) UTXOs
        "feeHandledInCoinbase": false      // If true, payment processor will NOT deduct poolFee/soloFee again
    },
    "txMessages": true,                     // Enable the pool signature OP_RETURN output in the coinbase tx
    "txMessageText": "",                    // Custom OP_RETURN message text (max 255 bytes, truncated if longer).
                                            // Falls back to a built-in default URL if left empty.
    "segwit": true,                         // Enable SegWit support
    "default_witness_commitment": true,     // Informational only — the witness commitment output is included
                                            // automatically whenever the daemon's getblocktemplate response
                                            // provides one; this flag is not read anywhere and does not gate it.

    // Network and timing settings
    "blockTime": 600,                       // Expected block time in seconds — used for luck (luckDays/
                                            // luckHours/luckMinute) calculations shown on the website
    "minConf": 101,                         // Informational/reference only. The value that actually gates
                                            // payouts is pool_configs/<coin>.json -> paymentProcessing.minConf
                                            // — keep the two in sync manually, since nothing enforces it.

    // Address validation (prevents invalid addresses)
    "addressValidation": {
        "validateWorkerUsername": true,   // Validate miner addresses
        "addressPrefix": "bc1",           // Expected address prefix (bc for BTC, bs for BTCS, myt for MYT)
        "minLength": 26,                  // Minimum address length
        "maxLength": 46                   // Maximum address length
    },

    // Block explorer URLs
    "explorer": {
        "txURL": "https://blockstream.info/tx/",        // Transaction explorer URL
        "blockURL": "https://blockstream.info/block/"   // Block explorer URL
    },

    // RPC daemon connection (reference only: the portal uses the daemons in the pool config)
    "rpc": {
        "host": "127.0.0.1",              // Daemon host
        "port": 8332,                     // Daemon RPC port
        "user": "rpcuser",                // RPC username
        "password": "rpcpassword"         // RPC password
    }
}
```

**Important Notes:**

- The value that actually gates payouts is `pool_configs/<coin>.json` -> `paymentProcessing.minConf` — the coin config's own `minConf` is a reference/documentation copy only and isn't read by the payment processor
- Bitcoin typically uses 101 confirmations, Bitcoin Silver uses 201
- ASICBoost is enabled by default for optimal performance with modern ASIC miners
- The `rpc` section is for reference only; the portal connects to the daemons listed in `pool_configs/<coin>.json`

## Pool config

Pool configurations define operational settings for each coin's mining pool. Each coin has its own pool config file in `pool_configs/`.

**Available Pool Configurations:**

- `pool_configs/bitcoin.json` - Bitcoin pool (ports 50212-50216)
- `pool_configs/bitcoinsilver.json` - Bitcoin Silver pool (ports 50222-50226)
- `pool_configs/bitcoingold.json` - Bitcoin Gold pool ports (50292-50296)
- `pool_configs/mytherra.json` - Mytherra pool (ports 50232-50236)
- `pool_configs/bitcoinii.json` - Bitcoin II pool (ports 50242-50246)
- `pool_configs/sha256coin.json` - SHA256COIN pool (ports 50272-50276)

**Pool Configuration Structure:**

```javascript
{
    // Basic settings
    "enabled": true,                        // Enable this pool
    "coin": "bitcoin.json",                 // Reference to coin config file
    "asicboost": true,                      // Enable ASICBoost for this pool
    "blockIdentifier": "",                  // Text embedded in the coinbase scriptSig, wrapped in slashes
                                            // (e.g. "mypool.com" -> "/mypool.com/"). Passed per-coin all the
                                            // way through to the built transaction — safe to set differently
                                            // per coin. Falls back to a built-in default if left empty.
                                            // Truncated at 64 bytes to stay within the scriptSig's 100-byte
                                            // consensus limit alongside the block height/timestamp/extranonce.

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
                                        // Remaining 6.1875 BTC is then split by poolFee/soloFee percentages
                                        // RECOMMENDED: Set to 0.0 and use poolFee/soloFee instead for simpler accounting
        "YOUR_FEE_ADDRESS": 0.0         // Coinbase reward split (0.0 = disabled, recommended)
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
                "targetTime": 30,        // Target time between shares (seconds)
                "retargetTime": 200,     // How often to adjust difficulty (seconds)
                "variancePercent": 5,    // Allowed variance percentage

                // Optional: lets miners override targetTime/retargetTime/
                // variancePercent per-connection via tt=/rt=/vp= password
                // params, each clamped to the range given here. Omit a
                // setting (or the whole block) to keep it operator-only —
                // see "Miner-Configurable VarDiff" below.
                "minerConfigurable": {
                    "targetTime": { "min": 15, "max": 120 },
                    "retargetTime": { "min": 60, "max": 600 },
                    "variancePercent": { "min": 5, "max": 50 }
                }
            }
        },
        "50213": {                       // Higher difficulty port for larger miners
            "diff": 50000,
            "tls": false,
            "soloMining": true,
            "varDiff": {
                "minDiff": 50000,
                "maxDiff": 5000000,
                "targetTime": 35,
                "retargetTime": 240,
                "variancePercent": 5
                // No minerConfigurable here — this port's varDiff timing
                // is fully operator-controlled; tt=/rt=/vp= are ignored.
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
    ]
}
```

**Difficulty Notes:**

> **Important:** Pool difficulty is NOT the same as network difficulty!
>
> - 1.0 pool difficulty = 8192 network difficulty
> - 0.125 pool difficulty = 1024 network difficulty
>
> When miners submit shares, the pool accumulates the difficulty:
>
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

**Coinbase Payouts (`coinbasePayouts`) Explained:**

`coinbasePayouts` is configured in `coins/*.json` and controls how payout funding and fee accounting are handled.

1. `enabled`
   - Enables coinbase payout logic for that coin.
   - When `false`, payout behavior is standard (no coinbase-only UTXO restrictions, normal fee deduction behavior).

2. `coinbaseOnly`
   - When `true`, payout transactions are funded only from generated coinbase UTXOs.
   - Non-coinbase UTXOs are excluded from payout funding.
   - Use this only if you explicitly want strict separation between mined rewards and other wallet funds.

3. `feeHandledInCoinbase`
   - When `true`, the payment processor does not deduct `poolFee`/`soloFee` again.
   - This prevents double charging if your fee is already handled at coinbase level (for example through `rewardRecipients`).
   - When `false`, `poolFee`/`soloFee` are deducted normally during payment processing.

**Recommended Config Patterns:**

1. Standard/simple pool setup (recommended)

```javascript
// coins/yourcoin.json
"coinbasePayouts": {
    "enabled": false,
    "coinbaseOnly": false,
    "feeHandledInCoinbase": false
}

// pool_configs/yourcoin.json
"rewardRecipients": {
    "YOUR_FEE_ADDRESS": 0.0
},
"paymentProcessing": {
    "poolFee": 2.0,
    "soloFee": 2.0
}
```

2. Coinbase-fee setup (advanced)

```javascript
// coins/yourcoin.json
"coinbasePayouts": {
    "enabled": true,
    "coinbaseOnly": false,
    "feeHandledInCoinbase": true
}

// pool_configs/yourcoin.json
"rewardRecipients": {
    "YOUR_FEE_ADDRESS": 1.0
},
"paymentProcessing": {
    "poolFee": 0.0,
    "soloFee": 0.0
}
```

Use this advanced mode only if you intentionally want fee collection to happen in coinbase outputs instead of payment-time deductions.

**Migration Note (From Mixed Config to Clean Mode):**

If your current config mixes `rewardRecipients` with non-zero `poolFee`/`soloFee`, move to one of these clean modes to avoid fee confusion.

1. Migrate to standard payment-fee mode (recommended)
   - Set `coins/*.json -> coinbasePayouts.enabled = false`
   - Set `coins/*.json -> coinbasePayouts.feeHandledInCoinbase = false`
   - Set `pool_configs/*.json -> rewardRecipients` percentages to `0.0`
   - Keep your desired `paymentProcessing.poolFee` and `paymentProcessing.soloFee`

2. Migrate to coinbase-fee mode (advanced)
   - Set `coins/*.json -> coinbasePayouts.enabled = true`
   - Set `coins/*.json -> coinbasePayouts.feeHandledInCoinbase = true`
   - Set fee percentages in `pool_configs/*.json -> rewardRecipients`
   - Set `paymentProcessing.poolFee = 0.0` and `paymentProcessing.soloFee = 0.0`

3. Optional strict-funding rule
   - Set `coinbasePayouts.coinbaseOnly = true` only if you want payouts funded strictly from mined coinbase UTXOs.

4. Verification checklist after migration
   - Confirm one and only one fee path is active.
   - Run one payment cycle and verify expected fee amounts.
   - Confirm no unexpected second fee deduction in logs and payout totals.

## Block notifications (blocknotify)

Each coin daemon tells the portal about a new block right away through the CLI, which listens on `cliPort` in `config.json` (127.0.0.1 only). Without it the pool only learns of new blocks from polling.

1. Keep `cliPort` at its default (17117) or set your own
2. In your daemon conf file set the `blocknotify` command to use:

```
node [path to cli.js] [coin name in config] [block hash symbol]
```

Example: inside `bitcoin.conf` add the line

```
blocknotify=node /home/user/sha256-nomp/scripts/cli.js blocknotify bitcoin %s
```

Set it on merged-mining aux coin daemons too, with the aux coin's pool name (e.g. `blocknotify vargamesh %s`): every parent pool that merge-mines that coin then fetches new aux work at once. See [Merged Mining](merged-mining.md).

Alternatively, you can use a more efficient block notify script written in pure C. Build and usage instructions
are commented in [scripts/blocknotify.c](../scripts/blocknotify.c).

## Block Confirmation Monitoring

Confirmation counts of found blocks (shown on the website while a block matures) are kept up to date by each coin's payment processor. Besides its payment run (`paymentInterval`), it reads `getblock` confirmations for every pending pool and solo block every `confirmationsInterval` seconds (default 120, minimum 30) and stores them in Redis (`<coin>:blocksPendingConfirms`). This covers every coin with payment processing enabled — including merged-mining aux coins — with nothing extra to configure:

```json
"paymentProcessing": {
  "enabled": true,
  "paymentInterval": 3600,
  "confirmationsInterval": 120
}
```

A block that leaves the main chain shows `-1` confirmations until the next payment run moves it to the orphaned (kicked) blocks. The old standalone `libs/blockConfirmations.js` script (hard-coded daemons, run by `stats.js`) has been removed in v1.5.0.
