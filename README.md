# SHA256-NOMP - Node Open Mining Portal

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

This is a SHA256 mining pool with solo mining support and ASICBoost with version rolling, based on Node Open Mining Portal.

#### Production Usage Notice

This is beta software. All of the following are things that can change and break an existing SHA256-NOMP setup: functionality of any feature, structure of configuration files and structure of redis data. If you use this software in production then _DO NOT_ pull new code straight into production usage because it can and often will break your setup and require you to tweak things like config files or redis data. _Only tagged releases are considered stable._

#### Paid Solution

Usage of this software requires abilities with sysadmin, database admin, coin daemons, and sometimes a bit of programming. Running a production pool can literally be more work than a full-time job.

### Features

- ✅ **Solo Mining Support** - Miners can mine solo with `m=solo` password parameter
- ✅ **ASICBoost Support** - Full support with version rolling for mining optimization
- ✅ **Multi-Version Support** - `mining.multi_version` extension for overt AsicBoost
- ✅ **Fixed Payment System** - Resolved double fee deduction issue (v1.4.1)
- ✅ **Multiple Payment Modes** - PROP and PPLNT payment systems
- ✅ **Dual Mining** - Support pool and solo mining simultaneously
- ✅ **Admin Center** - Web-based administration panel with secure bcrypt authentication
- ✅ **Merged Mining for Solo Miners** - Solo miners merge-mine aux coins (e.g. S256, ESF, VMESH) on the same work, each paid to their own address (v1.5.0)

### Recent Updates (v1.5.4)

Requires stratum-pool v1.5.3.

- **NEW**: Block effort. Every found block records its winning share difficulty, the network difficulty, the pool effort (work by all miners, pool and solo, since the pool's previous block, against the network difficulty) and the finder's own effort (a solo worker's round, or the shared round for pool blocks). Merge-mined blocks record the two difficulties only
- **NEW**: Pool Stats: Effort row (current effort and the average of the last 10 blocks), an effort-per-block bar chart with a 100% line, and Share / Net diff and Effort columns in the blocks table. Home pool cards show the effort too; the miner page shows each worker's current effort and the effort of each block it found
- **CHANGED**: Home page: the latest blocks list sits full width below the hashrate chart, one row per block with type, finder, difficulties, effort and status
- **FIXED**: Coin badges show the whole symbol (VMESH, not VMES)
- **FIXED** (stratum-pool v1.5.3): With merged mining, frequent aux updates kept the 50 s job refresh from firing, so blocks carried the previous block's timestamp
- **NEW**: ESF explorer links (1175explorer.com); Bitcoin Cash II in the price banner

### v1.5.3

Requires stratum-pool v1.5.2.

- **FIXED**: Pages stopped updating after PC sleep, a Wi-Fi change, a router idle timeout or a sleeping browser tab: the live stats stream could die without an error and the LIVE badge stayed on. The server now sends a heartbeat on every stream every 20s, the page reconnects after 60s of silence (and at once when the tab, network or a sleeping tab comes back), and the badge shows CONNECTING while the stream is silent
- **FIXED**: The miner chart bridged missed points with a straight line after such a gap; it now redraws each worker's line from the full history in every update. The home page chart, block feed and ages refresh as soon as the tab is visible again
- **FIXED**: Home page Global Pool Stats wrapped onto two lines as the hashrate grew; columns are now sized by their content and "pool / solo" values only break at the slash
- **NEW**: `/robots.txt` (pages may be crawled; `/api/`, `/admin`, `/get_page` and the per-address `/workers/` pages may not)
- **FIXED** (stratum-pool v1.5.2): Coins whose daemon was not ready at startup (common after a power cut) stayed offline until a manual restart; startup now retries until the daemon is ready

### v1.5.2

Security release for public pools; requires stratum-pool v1.5.1.

- **SECURITY**: `/api/worker_stats` and `/workers/<address>` only look up full addresses (20–100 letters and digits). A glob such as `addr=*` used to return the summed balances of every miner
- **SECURITY**: The miner page is rendered per request; it no longer puts the visitor's address and balances into the shared stats served by `/api/stats` and the live stream
- **SECURITY**: At most 10 live-stats streams per IP and 500 in total
- **SECURITY**: The CLI listener (`cliPort`) binds to 127.0.0.1 only
- **SECURITY**: Stratum (stratum-pool v1.5.1): at most 10 `mining.authorize` per connection; a non-string password no longer throws; a blocknotify during pool startup no longer throws
- **SECURITY**: Admin login checks the password type before bcrypt and compares session tokens in constant time
- **REMOVED**: Dead routes `/stats/shares` and `/payout/<address>`
- **CHANGED**: Bad client requests (broken JSON, bad URL encoding) log one warning line instead of an error with a stack trace

### v1.5.1

- **NEW**: Coin display names — coin files take an optional `displayName` (e.g. "Bitcoin Silver"), shown on the website and in the API instead of the capitalized pool name
- **CHANGED**: The ElevenSeventyFive pool ID is now `elevenseventyfive` (`coins/` and `pool_configs/elevenseventyfive.json`, aux coin key in the parent configs). Running pools move their Redis data with `scripts/rename-coin-redis.js`, see [Upgrading](#upgrading-sha256-nomp)
- **NEW**: Links in the pool message are clickable; prices in the price bar link to the coin's CoinGecko page
- **FIXED**: With many coins the coin tabs (Pool Stats, Miner Stats) stay on one row that scrolls sideways; network and block values no longer wrap; chart y-axis labels are no longer cut off; the home page block feed no longer stretches the hashrate chart

### v1.5.0

- **NEW**: Merged mining (Namecoin-style AuxPoW) for solo miners — aux coins are defined once in `mergedMining.auxCoins`, grouped in `mergedMining.groups`, and enabled per port with `auxGroup`. Solo miners add one payout address per aux coin to the password (`m=solo,s256=<address>`), checked with that coin's daemon at login. Each aux coin's own pool config pays the finder, minus its solo fee. Pool-mode miners keep plain jobs. See [Merged Mining](#merged-mining-solo-miners)
- **NEW**: Several Namecoin-standard aux coins in one merged-mining tree; ESF-style coins (reversed byte order, modulo slot, `getauxblock`) in their own group
- **FIXED**: A TLS (`stratum+ssl`) or HTTP connection to a plain stratum port no longer gets the IP banned — rental services such as MiningRigRentals try TLS first and were locked out for 10 minutes
- **FIXED**: Fee recipients (`rewardRecipients`) now take their output script from the daemon: bech32 fee addresses were skipped and P2SH fee addresses got a wrong (unspendable) script
- **FIXED**: Coinbase timestamps from 2038-01-19 would have crashed job creation; non-ASCII `blockIdentifier`s got a wrong length; mining-key payout addresses had a double checksum
- **FIXED**: A bare `solo` or `solo=true` password now selects solo mining in the stratum layer too, matching the payout side
- **FIXED**: The connection count in the 5-minute stats never went down; regtest was reported as "Mainnet" at startup
- **NEW**: Redesigned website — dark by default with a light mode toggle, a scrolling network bar with height/difficulty/hashrate/last block per coin, and a live status indicator. The home page adds global stats, per-coin pool cards (fees, ports, merged coins), a hashrate chart and a latest-blocks feed; Getting Started builds the miner settings (URL, username, password with merged-mining addresses) for the chosen coin and port. Pool name, tagline, logos and price-ticker coins come from `website.branding` in `config.json`. Pool Stats and Miner Stats show one tab per coin, with paginated blocks and miners, confirmation progress, and badges for merged mining. Each miner page lists the miner's workers and the blocks they found.
- **NEW**: The price bar reads the CoinGecko API directly (no third-party script on the site); the CDN libraries load with subresource integrity, and the Content Security Policy blocks inline event handlers
- **CHANGED**: Stratum usernames may only contain letters, digits, `.`, `_` and `-` (`address.worker`); others are refused at login, so a worker name can never carry markup into the website, API or logs
- **FIXED**: Finding a solo block reset the round shares and best share of every solo miner, not only the finder; solo hashrate samples were never trimmed from Redis
- **CHANGED**: `website.adminCenter.enabled` is `false` in the shipped configs; enable it after setting `passwordHash`
- **NEW**: VargaMesh (VMESH) as a merged-mined aux coin, through the new `getblocktemplate` aux mode for nodes without aux-block RPCs
- **NEW**: Merge-mined coins show the hashrate merging them ("merged hashrate", miners listed "via BTCS") on Pool Stats, Miner Stats and the home page; it is kept apart from their own hashrate so global totals do not count the same hashes twice
- **NEW**: Pool Stats and Miner Stats have one tab per coin; the miner page lists workers as rows and the miner's found blocks on every coin (merge-mined ones included), with confirmation progress; long lists are paginated
- **NEW**: `/api/stats` also carries `merged` in the shape other pools publish for listing sites (`"[{algorithm:sha256,symbol:vmesh,name:vargamesh}]"`), next to `merged_with`
- **IMPROVED**: A payment cycle starts within about a minute of a found block, so immature balances show it at once (before: up to `paymentInterval`); the regular schedule continues
- **IMPROVED**: When an aux chain finds a block, merged jobs go out with `clean_jobs=true` so miners drop work that can no longer win it; stale aux work is no longer submitted; ESF work is refreshed on a new tip or once a minute instead of on every poll
- **NEW**: Getting Started explains merged-only coins (no ports of their own, e.g. VMESH) and sets up a parent port for them
- **NEW**: `website.branding.ogImageAlt`, plus `og:site_name` and image alt tags for link previews
- **FIXED**: The client IP could be faked with an `X-Forwarded-For` header to get around the API rate limit, bans and the admin login lockout; proxy headers are now trusted only from the same machine (a reverse proxy such as nginx)
- **REMOVED**: The old client-side mining key page (`/key.html`, `mining_key`), which was never served, and unused files (`libs/workerapi.js`, old stats scripts and stylesheets)
- **NEW**: Daemon entries accept `"wallet": "<name>"` (RPCs go to `/wallet/<name>`), for daemons with several wallets loaded
- **FIXED**: A failing `getbalance` at startup (e.g. error -19, several wallets loaded) silently left a coin's payment processing off; it is now logged
- **FIXED**: Admin Center pool management failed to load ("value.toFixed is not a function") when a coin reported its difficulty as text
- **NEW**: `/api/stats` shows merged mining per coin (`merged_with`, `merge_mined_by`, `mergedMining`)
- **IMPROVED**: Block confirmation counts are updated by each coin's payment processor every `confirmationsInterval` seconds (default 120) for every coin, including aux coins; the standalone `libs/blockConfirmations.js` (hard-coded daemons, S256/BTGS missing) is removed
- **UPDATED**: Dependencies (no known vulnerabilities); Node.js 24 required — redis 3 → 6 (through `libs/redisCompat.js`, which keeps the v3 callback API and replies), express 4 → 5, archiver 7 → 8, dateformat 4 → 5; unused axios and nonce removed

### Recent Updates (v1.4.7)

- **NEW**: Optional miner-configurable variable difficulty (`tt=`/`rt=`/`vp=` password params) — lets experienced miners tune their own retarget timing within operator-defined bounds, per port, off by default
- **IMPROVED**: Getting Started page documents the new tuning parameters, with a clear "most miners don't need this" framing for casual users

### Recent Updates (v1.4.6)

- **FIXED**: Coinbase transaction framing bug that corrupted the block's merkle root when `txMessages` was enabled — pool signature is now embedded as a standards-compliant OP_RETURN output instead of invalid trailing bytes
- **FIXED**: `blockIdentifier` was written to shared global state, leaking one coin's identifier into every other coin's mined blocks when running multiple coins in the same process — now threaded per-coin end to end, with a byte-length safety cap
- **FIXED**: `md=` (minimum difficulty) password parameter now correctly floors the miner's assigned difficulty instead of being silently ignored
- **FIXED**: Immature balance display showed raw satoshis instead of coins due to a missing unit conversion in the payment processor
- **NEW**: Security module bans (rate limiting, malformed messages, flood detection) now actually block reconnection attempts, instead of being logged without being enforced
- **NEW**: Worker cards on the website now show Last Share (time + actual difficulty) and Best Share (highest difficulty this round)
- **NEW**: Log archives are compacted into one monthly archive instead of being deleted after 30 days
- **IMPROVED**: Graceful shutdown handling — `systemctl restart` no longer races with worker auto-respawn logic

### Recent Updates (v1.4.5)

- **NEW**: Added `mining.multi_version` stratum extension for overt AsicBoost
- **NEW**: Admin Center with secure bcrypt password hashing
- **IMPROVED**: Enhanced stratum protocol handling

### Recent Updates (v1.4.4)

- **UPDATE**: Security enhancements
- **Fixed**: Memory optimization

### Recent Updates (v1.4.3)

- **UPDATE**: Added Whatsminer support

### Recent Updates (v1.4.2)

- **UPDATE**: Updated package.json dependencies
- **FIXED**: Logging and added log rotation, log archive

### Recent Updates (v1.4.1)

- **FIXED**: Double fee deduction bug in solo mining payment processing
- **IMPROVED**: Solo mining fees now correctly compensate for coinbase rewardRecipients
- **ENHANCED**: Consistent fee handling for both 'generate' and 'immature' blocks
- **OPTIMIZED**: Payment processor efficiency improvements

### Supported Coins

SHA256-NOMP comes pre-configured with the following coins:

| Coin           | Symbol | Algorithm | Ports       | Min Confirmations | Block Time |
| -------------- | ------ | --------- | ----------- | ----------------- | ---------- |
| Bitcoin        | BTC    | SHA256    | 50212-50216 | 101               | 10 min     |
| Bitcoin Silver | BTCS   | SHA256    | 50222-50227 | 201               | 5 min      |
| Bitcoin Gold   | BTGS   | SHA256    | 50292-50296 | 101               | 10 min     |
| Mytherra       | MYT    | SHA256    | 50232-50236 | 101               | 5 min      |
| Bitcoin II     | BC2    | SHA256    | 50242-50246 | 101               | 10 min     |
| SHA256COIN     | S256   | SHA256    | 50272-50276 | 201               | 20 min     |
| ElevenSeventyFive | ESF | SHA256    | 50282-50286 | 101               | 10 min     |
| VargaMesh      | VMESH  | SHA256    | merged only | 101               | 2 min      |

All coins support:

- ✅ ASICBoost with version rolling
- ✅ SegWit support
- ✅ Solo and pool mining modes
- ✅ Variable difficulty per port
- ✅ Multiple mining ports for different hashrates
- ✅ Merged mining for solo miners: S256 on every coin except S256 and ESF themselves; Bitcoin Silver ports 50222–50226 also merge-mine VMESH, and port 50227 merge-mines ESF (see [Merged Mining](#merged-mining-solo-miners))

### Community

If your pool uses SHA256-NOMP let us know and we will list your website here.

<div align="center">

### Some pools using SHA256-NOMP:

[![Website](https://img.shields.io/badge/Pool-sha256--mining.go.ro-blue?style=for-the-badge)](https://sha256-mining.go.ro:50300)

_Building high-performance SHA256 mining infrastructure_

</div>

# Usage

#### Requirements

- Coin daemon(s) (find the coin's repo and build latest version from source or use the already built ones)
- [Node.js](http://nodejs.org/) v24+ (see `.nvmrc`; [installation instructions](https://nodejs.org/en/download))
- [Redis](http://redis.io/) key-value store v6.2+ ([follow these instructions](http://redis.io/topics/quickstart))

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

- https://en.bitcoin.it/wiki/Running_bitcoind
- https://en.bitcoin.it/wiki/Data_directory
- https://en.bitcoin.it/wiki/Original_Bitcoin_client/API_Calls_list
- https://en.bitcoin.it/wiki/Difficulty

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
- **coins/\*.json** - Coin-specific configurations (blockchain settings)
- **pool_configs/\*.json** - Pool operational configurations (ports, fees, payments)

##### Portal config

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

##### Coin config

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

##### Pool config

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

#### Solo Mining Configuration

Miners connect for solo mining using the password parameter:

```
Username: YOUR_BITCOIN_ADDRESS
Password: m=solo
```

A worker name can follow the address (`YOUR_BITCOIN_ADDRESS.rig1`). Usernames may only use letters, digits, `.`, `_` and `-`; the pool refuses others at login.

Example connections:

- **CGMiner**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo`
- **With custom difficulty**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo,d=65536`

#### Merged Mining (Solo Miners)

Solo miners can merge-mine aux coins on the same work as the parent coin (Namecoin-style AuxPoW). Pool-mode miners are not affected: they always get plain parent jobs.

**For miners** — mine solo on a merged-mining port and add an address for each aux coin you want paid:

```
Username: YOUR_PARENT_COIN_ADDRESS.worker
Password: m=solo,s256=YOUR_S256_ADDRESS
```

If you leave out an aux coin's address, its blocks are still found and submitted, but the reward stays in the pool wallet.

**For operators** — in the parent coin's pool config (all pool configs except `sha256coin.json` ship with S256 merged mining enabled):

```json
"mergedMining": {
  "enabled": true,
  "auxPollInterval": 5000,
  "auxCoins": {
    "sha256coin": {
      "symbol": "S256",
      "chainId": 598,
      "byteOrder": "namecoin",
      "slotRule": "namecoin",
      "addressParam": "s256",
      "address": "YOUR_S256_POOL_ADDRESS",
      "daemon": { "host": "127.0.0.1", "port": 25332, "user": "rpcuser", "password": "YOUR_RPC_PASSWORD" }
    }
  },
  "groups": {
    "standard": ["sha256coin"]
  }
},
"ports": {
  "50222": { "diff": 15000, "soloMining": true, "auxGroup": "standard", "varDiff": { "...": "..." } }
}
```

- `enabled: false` turns merged mining off on every port; a port without `auxGroup` mines the parent coin only.
- **Each aux coin needs its own pool config** (e.g. `pool_configs/sha256coin.json`) with `paymentProcessing.enabled` and `paymentProcessing.soloMining` on, using the same daemon/wallet and pool address as in `auxCoins`. Merged-mined blocks are recorded there as solo blocks of the miner's aux address, and that pool's payment processor pays the finder (minus its `soloFee`) once the block matures. The portal refuses to start if this config is missing.
- Namecoin-standard coins (S256, Namecoin, …) can share a group: add the coin to `auxCoins` and its name to the group. A coin with `byteOrder: "reversed"` or `slotRule: "modulo"` must be alone in its own group, on its own port(s).
- **ESF example** (`pool_configs/bitcoinsilver.json`): `auxCoins.elevenseventyfive` (ElevenSeventyFive, chain ID 1175, `byteOrder: "reversed"`, `slotRule: "modulo"`, `addressParam: "esf"`) in group `esf`, used by port **50227** — solo miners there mine BTCS + ESF with `m=solo,esf=<ESF address>`, while ports 50222–50226 mine BTCS + S256. ESF's own pool config is `pool_configs/elevenseventyfive.json` (coin file `coins/elevenseventyfive.json`; its `displayName` "ElevenSeventyFive" is what the website and API show — the optional `displayName` field works for any coin file, otherwise the capitalized pool name is shown), which pays the ESF solo blocks. ESF has no `createauxblock`; the pool uses `getauxblock` automatically. ESF accepts merge-mined blocks from its block 31733.
- **VargaMesh example** (`pool_configs/bitcoinsilver.json`): `auxCoins.vargamesh` (VMESH, chain ID 22093 = `0x564D`, `addressParam: "vmesh"`, `mode: "getblocktemplate"`) shares the `standard` group with S256, so solo miners on ports 50222–50226 mine BTCS + S256 + VMESH with `m=solo,s256=<S256 address>,vmesh=<VMESH address>`. VargaMesh requires AuxPoW from block 1, so it can only be merge-mined: its own pool config `pool_configs/vargamesh.json` has no ports and only records and pays the blocks.
- `mode` selects how the pool gets aux work: `auxblock` (default) uses the node's `createauxblock`/`getauxblock` and `submitauxblock`; `getblocktemplate` is for nodes without those RPCs (VargaMesh) — the pool builds the aux block from `getblocktemplate` (coinbase paying `address`, witness commitment, the node's `auxpow_childnonce`) and submits header + auxpow + transactions with `submitblock`. The node must report `auxpow: true` and the configured chain ID.
- With merged mining on, `blockIdentifier` is capped at 30 bytes to keep the coinbase scriptSig within 100 bytes.
- Every aux block is logged (`[AUX BLOCK FOUND!]`) and listed in Redis under `<coin>:auxBlocks:<auxcoin>`.
- `/api/stats` shows merged mining per coin: `merged_with` in the YIIMP-style shape pool listing sites read (`{"merged_with": "S256,ESF"}`, or `"0"`), `merge_mined_by` on aux coins (e.g. `["BTCS"]`), and `mergedMining` with each aux coin's symbol, chain ID, ports and password example.

#### Password Parameters

Miners can pass one or more of the following via the stratum password field, comma-separated:

| Parameter    | Description                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m=solo`     | Mine solo instead of pool mode (a bare `solo` or `solo=true` works too)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `d=<value>`  | Set the miner's _starting_ difficulty immediately on connect, overriding the port's configured default                                                                                                                                                                                                                                                                                                                                  |
| `md=<value>` | Set a _minimum_ difficulty floor — variable difficulty will retarget freely above this value but will never drop the miner below it, even if their share timing suggests it should. Useful for large ASICs (S19/S21/T21-class) to reduce unnecessary share traffic. The floor is clamped between the port's own `minDiff` and `maxDiff`, so it can raise the effective floor but can never push it above the port's configured ceiling. |
| `tt=<value>` | Requested varDiff target time (seconds between shares). Only takes effect on ports with `minerConfigurable.targetTime` set; clamped to that range. Ignored (falls back to the port default) otherwise. |
| `rt=<value>` | Requested varDiff retarget time (seconds between adjustments). Only takes effect on ports with `minerConfigurable.retargetTime` set; clamped to that range. Ignored otherwise. |
| `vp=<value>` | Requested varDiff variance percent. Only takes effect on ports with `minerConfigurable.variancePercent` set; clamped to that range. Ignored otherwise. |

| `s256=<address>`, `esf=<address>`, … | Merged mining payout address for an aux coin; the key is that coin's `addressParam`. Only used by solo miners on ports with an `auxGroup`. Checked with the coin's daemon at login; an invalid address refuses the login. See [Merged Mining](#merged-mining-solo-miners). |

Example: `-p m=solo,d=1000000,md=500000` starts the miner at difficulty 1,000,000 and guarantees it never retargets below 500,000.

#### Miner-Configurable VarDiff (tt=/rt=/vp=)

For experienced miners who know their own hashrate, a port can optionally let miners tune how their own
variable difficulty behaves, instead of only using the operator's fixed per-port settings. This is
**off by default** — a port only accepts `tt=`/`rt=`/`vp=` if its config explicitly includes a
`varDiff.minerConfigurable` block (see the `50212` example under [Pool config](#pool-config) above).

How it behaves:

- **Disabled ports ignore the parameters silently.** No error, no rejection — the connection proceeds
  normally using the port's own defaults, exactly as if the miner hadn't sent them.
- **Values are always clamped**, never rejected outright. A request outside the operator's configured
  `min`/`max` range is silently adjusted to the nearest allowed value rather than causing a connection
  failure — there's no way for a miner to misconfigure this into something harmful to the pool.
- **Settings are locked in at the miner's first submitted share** and apply for the rest of that
  connection's session; reconnecting re-evaluates them from the current password.
- Each of the three settings (`targetTime`, `retargetTime`, `variancePercent`) can be enabled
  independently — a port can allow miner-configurable `targetTime` while keeping `retargetTime` and
  `variancePercent` operator-only, for example.

Example: `-p m=solo,tt=30,rt=180,vp=20` requests a 30-second target time between shares, retargeting
every 180 seconds, with 20% variance tolerance — each only honored if that port's config allows it.

#### Multi-Version Support (mining.multi_version)

SHA256-NOMP supports the `mining.multi_version` stratum extension for overt AsicBoost mining. This is an alternative to `mining.configure` version rolling.

##### Enabling Multi-Version

Add the `multiVersion` configuration to your coin config (`coins/*.json`):

```javascript
{
    "name": "bitcoin",
    "symbol": "BTC",
    "algorithm": "sha256",
    // ... other settings ...

    "multiVersion": {
        "enabled": true,                    // Enable mining.multi_version support
        "maxVersions": 4,                   // Maximum versions a miner can request (1-16)
        "generationMode": "sequential"      // Version generation mode
    }
}
```

##### How It Works

1. Miner sends: `{"method": "mining.multi_version", "params": [4]}`
2. Pool responds with `result: true` if enabled
3. Pool sends jobs with multiple versions in `mining.notify`
4. Miner can use any of the provided versions for share submission

##### Miner Compatibility

Miners supporting `mining.multi_version`:

- Custom firmware with multi_version support
- Some Bitmain firmware variants
- Mining proxies with multi_version capability

---

#### Admin Center

SHA256-NOMP includes a web-based administration panel for managing your pool. Access it at `http://yourpool.com/admin`.

##### Features

- View and manage active pools
- Monitor pool statistics
- Add/modify pool configurations
- Secure bcrypt password authentication

##### Setting Up Admin Center

**Step 1: Generate a Password Hash**

For security, admin passwords are stored as bcrypt hashes, not plain text. Use the included tool to generate your hash:

```bash
cd nomp-password
node generate-password-hash.js
```

The tool will:

1. Prompt you to enter your desired password
2. Generate a secure bcrypt hash
3. Show you the hash to use in your config

Example output:

```
================================================================================
SHA256-NOMP Admin Password Hash Generator
================================================================================

Enter your desired admin password: ********

Generating bcrypt hash (this may take a moment)...

================================================================================
Password Hash Generated Successfully!
================================================================================

Your bcrypt hash is:

  $2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqvZjCn4Y5XpLz8DJDm7X8NlZPvDK

================================================================================
```

**Step 2: Configure config.json**

Add the hash to your `config.json`:

```javascript
"website": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 80,
    "stratumHost": "yourpool.com",
    "stats": {
        "updateInterval": 15,
        "historicalRetention": 43200,
        "hashrateWindow": 300
    },
    "adminCenter": {
        "enabled": true,
        "passwordHash": "$2a$10$N9qo8uLOickgx2ZMRZoMy.MqrqvZjCn4Y5XpLz8DJDm7X8NlZPvDK"
    }
}
```

> **IMPORTANT:** Use `"passwordHash"` (not `"password"`) to enable secure bcrypt authentication.

**Step 3: Access Admin Panel**

1. Navigate to `http://yourpool.com/admin`
2. Enter your original password (not the hash!)
3. Optionally check "Stay Logged In" to save session

##### Security Notes

- **Never share your password hash publicly** (though it's much safer than plain text)
- Use a strong password (20+ characters recommended)
- Each hash generation produces a different result (this is normal and secure)
- If you forget your password, simply generate a new hash
- The admin panel uses cookies for session management
- For production, always use HTTPS to protect credentials in transit

##### Legacy Plain Text Password (Not Recommended)

For backwards compatibility, you can still use plain text passwords:

```javascript
"adminCenter": {
    "enabled": true,
    "password": "your-plain-text-password"  // NOT RECOMMENDED
}
```

> **WARNING:** Plain text passwords are stored in your config file and could be exposed. Always use `passwordHash` for production deployments.

---

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

Confirmation counts of found blocks (shown on the website while a block matures) are kept up to date by each coin's payment processor. Besides its payment run (`paymentInterval`), it reads `getblock` confirmations for every pending pool and solo block every `confirmationsInterval` seconds (default 120, minimum 30) and stores them in Redis (`<coin>:blocksPendingConfirms`). This covers every coin with payment processing enabled — including merged-mining aux coins — with nothing extra to configure:

```json
"paymentProcessing": {
  "enabled": true,
  "paymentInterval": 3600,
  "confirmationsInterval": 120
}
```

A block that leaves the main chain shows `-1` confirmations until the next payment run moves it to the orphaned (kicked) blocks. The old standalone `libs/blockConfirmations.js` script (hard-coded daemons, run by `stats.js`) has been removed in v1.5.0.

#### 4) Start the portal

```bash
npm start
```

###### Optional enhancements for your awesome new mining pool server setup:

- Use something like [forever](https://github.com/nodejitsu/forever) to keep the node script running
  in case the master process crashes.
- Use something like [redis-commander](https://github.com/joeferner/redis-commander) to have a nice GUI
  for exploring your redis database.
- Use something like [logrotator](http://www.thegeekstuff.com/2010/07/logrotate-examples/) to rotate log
  output from SHA256-NOMP.
- Use [New Relic](http://newrelic.com/) to monitor your SHA256-NOMP instance and server performance.

#### Upgrading SHA256-NOMP

When updating SHA256-NOMP to the latest code its important to not only `git pull` the latest from this repo, but to also update
the `node-stratum-pool` module, and any config files that may have been changed.

Upgrading from 1.4.x to 1.5.0: Node.js 24+ and Redis 6.2+ are required; usernames with characters other than letters, digits, `.`, `_` and `-` are refused; the admin center ships disabled; merged mining is configured per parent pool (`mergedMining`, see above) and every aux coin needs its own pool config. Redis data from 1.4.x is kept.

Upgrading from 1.5.0 to 1.5.1 with ElevenSeventyFive (ESF) configured: its pool ID changed from `esf1175coin` to `elevenseventyfive`. With the pool stopped and a Redis backup taken, rename `coins/esf1175coin.json` and `pool_configs/esf1175coin.json` to `elevenseventyfive.json` (and their `name` / `coin` fields), rename the aux coin key `esf1175coin` in every parent pool config (`mergedMining.auxCoins` and `groups`), change the ESF daemon's `blocknotify` to `... blocknotify elevenseventyfive %s` and restart it, then run `node scripts/rename-coin-redis.js esf1175coin elevenseventyfive` (dry run) and again with `--apply`. Pending ESF blocks and balances move with the data.

- Inside your SHA256-NOMP directory (where the init.js script is) do `git pull` to get the latest SHA256-NOMP code.
- Remove the dependencies by deleting the `node_modules` directory with `rm -r node_modules`.
- Run `npm update` to force updating/reinstalling of the dependencies.
- Compare your `config.json` and `pool_configs/coin.json` configurations to the latest example ones in this repo or the ones in the setup instructions where each config field is explained. <b>You may need to modify or add any new changes.</b>

---

<div align="center">

## Maintained By

### **janos-raul**

#### Developer & Maintainer

[![Website](https://img.shields.io/badge/Pool-sha256--mining.go.ro-blue?style=for-the-badge)](https://sha256-mining.go.ro:50300)

_Building high-performance SHA256 mining infrastructure_

</div>

---

## Donations

Donations for development are greatly appreciated!

- BTC: `bc1q0aa3k39ww33z24p3wpk72jjn32h2n5rfr85pnx`
- BTCS: `bs1q8dnz4q52czdusl8hy04fw3jryj2kc3earck3y2`
- BCH: `qzhpajyfz7yvl8963rre5zqdp72pqy47ysttst0wmr`

## Credits

### SHA256-NOMP

- [Janos-Raul](https://github.com/janos-raul) - maintainer, fixed payment processing

### ZNY-NOMP (Original Fork Base)

- [ROZ](https://github.com/ROZ-MOFUMOFU-ME)
- [zinntikumugai](https://github.com/zinntikumugai)

### cryptocurrency-stratum-pool

- [Invader444](//github.com/Invader444)

### S-NOMP

- [egyptianbman](https://github.com/egyptianbman)
- [nettts](https://github.com/nettts)
- [potato](https://github.com/zzzpotato)

### K-NOMP

- [yoshuki43](https://github.com/yoshuki43)

### Z-NOMP

- [Joshua Yabut / movrcx](https://github.com/joshuayabut)
- [Aayan L / anarch3](https://github.com/aayanl)
- [hellcatz](https://github.com/hellcatz)

### NOMP

- [Matthew Little / zone117x](https://github.com/zone117x) - developer of NOMP
- [Jerry Brady / mintyfresh68](https://github.com/bluecircle) - historical contributions around switching/proxy-per-algo feature
- [Tony Dobbs](http://anthonydobbs.com) - designs for front-end and created the NOMP logo
- [LucasJones](//github.com/LucasJones) - got p2p block notify working and implemented additional hashing algos
- [vekexasia](//github.com/vekexasia) - co-developer & great tester
- [TheSeven](//github.com/TheSeven) - answering an absurd amount of my questions and being a very helpful gentleman
- [UdjinM6](//github.com/UdjinM6) - helped implement fee withdrawal in payment processing
- [Alex Petrov / sysmanalex](https://github.com/sysmanalex) - contributed the pure C block notify script
- [svirusxxx](//github.com/svirusxxx) - sponsored development of MPOS mode
- [icecube45](//github.com/icecube45) - helping out with the repo wiki
- [Fcases](//github.com/Fcases) - ordered me a pizza <3
- Those that contributed to [node-stratum-pool](//github.com/zone117x/node-stratum-pool#credits)

## License

Released under the MIT License. See LICENSE file.