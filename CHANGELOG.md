# Changelog

All notable changes to SHA256-NOMP, newest first. Each release names the [stratum-pool](https://github.com/janos-raul/node-stratum-pool) version it needs (`package.json` pins it by tag).

## v1.5.8

Requires stratum-pool v1.5.5 (unchanged).

### Fixed

- A worker that mines solo and pool under the same name (e.g. a rig that reconnects without `m=solo`) had its shares counted in the mode of whichever connection logged in last on that thread: solo or pool now comes from each share's own connection
- The miner page showed only one row for such a name, and one chart line holding both modes' hashrate. The solo side is now its own row (Solo badge) and chart line; `/api/worker_stats` keys it `<address>.<worker>|solo` when the name is also used in pool mode. Each row's average hashrate counts only its own chart line

## v1.5.7

Requires stratum-pool v1.5.5.

### Added

- Miner page worker table shows **Shares A / S / R** (accepted / stale / rejected since the worker connected; percentages in the tooltip) and **Ping** (the network round trip of the worker's connection, measured by the kernel with `ss -ti`, so miners need no ping support). Only the miner's own `/api/worker_stats` has these (`conn` per worker); `/api/stats` doesn't

### Changed

- `/api/worker_stats` returns copies of the worker objects instead of adding the miner's balances to the shared stats

### Fixed

- Merged miners kept hashing on an old aux tip for up to `auxPollInterval` (5 s) after the aux chain moved, and aux blocks found then were orphaned ("inconclusive"). An aux coin's `blocknotify` now makes every parent pool that merge-mines it fetch new aux work at once

## v1.5.6

Requires stratum-pool v1.5.4 (unchanged).

### Changed

- The hashrate history is serialized once per stats update instead of on every request, and the website no longer renders full pages nobody reads on each update

### Fixed

- "Too many requests" while browsing. Every page click loaded the blocks and hashrate history two or three times, so a few clicks hit the 30/min API limit
- Charts appeared about a second late. Response compression was set up after the routes and never ran; the hashrate history (`/api/pool_stats`, ~1.5 MB of JSON) now goes out gzip/brotli compressed (~20 KB), and so does the live stats stream (~4x smaller)

## v1.5.5

Requires stratum-pool v1.5.4.

### Changed

- Leaner logs, about 80% less in `all.log`. Each pool message is written once instead of twice (stratum-pool v1.5.4), and lines every cluster thread repeats (job rebroadcasts, new aux blocks, block notifications) come from the first thread only. Per-cycle stats and template lines are gone, active miner counts are logged when they change, and immature blocks are no longer re-listed every payment cycle (the cycle summary counts them; each block is detailed once when it matures). Warnings, errors, blocks and payments are unchanged, and the category logs stay complete

### Notes

- Under systemd, `"logToConsole": false` in `config.json` keeps the pool's output out of the journal (it duplicates `logs/all.log`); crashes still reach the journal. For coin daemons, `printtoconsole=0` in their conf does the same for `debug.log`

## v1.5.4

Requires stratum-pool v1.5.3.

### Added

- Block effort. Every found block records its winning share difficulty, the network difficulty, the pool effort (work by all miners, pool and solo, since the pool's previous block, against the network difficulty) and the finder's own effort (a solo worker's round, or the shared round for pool blocks). Merge-mined blocks record the two difficulties only
- Pool Stats: Effort row (current effort and the average of the last 10 blocks), an effort-per-block bar chart with a 100% line, and Share / Net diff and Effort columns in the blocks table. Home pool cards show the effort too; the miner page shows each worker's current effort and the effort of each block it found
- ESF explorer links (1175explorer.com); Bitcoin Cash II in the price banner

### Changed

- Home page: the latest blocks list sits full width below the hashrate chart, one row per block with type, finder, difficulties, effort and status

### Fixed

- Coin badges show the whole symbol (VMESH, not VMES)
- (stratum-pool v1.5.3) With merged mining, frequent aux updates kept the 50 s job refresh from firing, so blocks carried the previous block's timestamp

## v1.5.3

Requires stratum-pool v1.5.2.

### Added

- `/robots.txt` (pages may be crawled; `/api/`, `/admin`, `/get_page` and the per-address `/workers/` pages may not)

### Fixed

- Pages stopped updating after PC sleep, a Wi-Fi change, a router idle timeout or a sleeping browser tab: the live stats stream could die without an error and the LIVE badge stayed on. The server now sends a heartbeat on every stream every 20s, the page reconnects after 60s of silence (and at once when the tab, network or a sleeping tab comes back), and the badge shows CONNECTING while the stream is silent
- The miner chart bridged missed points with a straight line after such a gap; it now redraws each worker's line from the full history in every update. The home page chart, block feed and ages refresh as soon as the tab is visible again
- Home page Global Pool Stats wrapped onto two lines as the hashrate grew; columns are now sized by their content and "pool / solo" values only break at the slash
- (stratum-pool v1.5.2) Coins whose daemon was not ready at startup (common after a power cut) stayed offline until a manual restart; startup now retries until the daemon is ready

## v1.5.2

Security release for public pools; requires stratum-pool v1.5.1.

### Changed

- Bad client requests (broken JSON, bad URL encoding) log one warning line instead of an error with a stack trace

### Removed

- Dead routes `/stats/shares` and `/payout/<address>`

### Security

- `/api/worker_stats` and `/workers/<address>` only look up full addresses (20–100 letters and digits). A glob such as `addr=*` used to return the summed balances of every miner
- The miner page is rendered per request; it no longer puts the visitor's address and balances into the shared stats served by `/api/stats` and the live stream
- At most 10 live-stats streams per IP and 500 in total
- The CLI listener (`cliPort`) binds to 127.0.0.1 only
- Stratum (stratum-pool v1.5.1): at most 10 `mining.authorize` per connection; a non-string password no longer throws; a blocknotify during pool startup no longer throws
- Admin login checks the password type before bcrypt and compares session tokens in constant time

## v1.5.1

### Added

- Coin display names — coin files take an optional `displayName` (e.g. "Bitcoin Silver"), shown on the website and in the API instead of the capitalized pool name
- Links in the pool message are clickable; prices in the price bar link to the coin's CoinGecko page

### Changed

- The ElevenSeventyFive pool ID is now `elevenseventyfive` (`coins/` and `pool_configs/elevenseventyfive.json`, aux coin key in the parent configs). Running pools move their Redis data with `scripts/rename-coin-redis.js`, see [Upgrading](guides/upgrading.md)

### Fixed

- With many coins the coin tabs (Pool Stats, Miner Stats) stay on one row that scrolls sideways; network and block values no longer wrap; chart y-axis labels are no longer cut off; the home page block feed no longer stretches the hashrate chart

## v1.5.0

### Added

- Merged mining (Namecoin-style AuxPoW) for solo miners — aux coins are defined once in `mergedMining.auxCoins`, grouped in `mergedMining.groups`, and enabled per port with `auxGroup`. Solo miners add one payout address per aux coin to the password (`m=solo,s256=<address>`), checked with that coin's daemon at login. Each aux coin's own pool config pays the finder, minus its solo fee. Pool-mode miners keep plain jobs. See [Merged Mining](guides/merged-mining.md)
- Several Namecoin-standard aux coins in one merged-mining tree; ESF-style coins (reversed byte order, modulo slot, `getauxblock`) in their own group
- Redesigned website — dark by default with a light mode toggle, a scrolling network bar with height/difficulty/hashrate/last block per coin, and a live status indicator. The home page adds global stats, per-coin pool cards (fees, ports, merged coins), a hashrate chart and a latest-blocks feed; Getting Started builds the miner settings (URL, username, password with merged-mining addresses) for the chosen coin and port. Pool name, tagline, logos and price-ticker coins come from `website.branding` in `config.json`. Pool Stats and Miner Stats show one tab per coin, with paginated blocks and miners, confirmation progress, and badges for merged mining. Each miner page lists the miner's workers and the blocks they found.
- The price bar reads the CoinGecko API directly (no third-party script on the site); the CDN libraries load with subresource integrity, and the Content Security Policy blocks inline event handlers
- VargaMesh (VMESH) as a merged-mined aux coin, through the new `getblocktemplate` aux mode for nodes without aux-block RPCs
- Merge-mined coins show the hashrate merging them ("merged hashrate", miners listed "via BTCS") on Pool Stats, Miner Stats and the home page; it is kept apart from their own hashrate so global totals do not count the same hashes twice
- Pool Stats and Miner Stats have one tab per coin; the miner page lists workers as rows and the miner's found blocks on every coin (merge-mined ones included), with confirmation progress; long lists are paginated
- `/api/stats` also carries `merged` in the shape other pools publish for listing sites (`"[{algorithm:sha256,symbol:vmesh,name:vargamesh}]"`), next to `merged_with`
- Getting Started explains merged-only coins (no ports of their own, e.g. VMESH) and sets up a parent port for them
- `website.branding.ogImageAlt`, plus `og:site_name` and image alt tags for link previews
- Daemon entries accept `"wallet": "<name>"` (RPCs go to `/wallet/<name>`), for daemons with several wallets loaded
- `/api/stats` shows merged mining per coin (`merged_with`, `merge_mined_by`, `mergedMining`)

### Changed

- Stratum usernames may only contain letters, digits, `.`, `_` and `-` (`address.worker`); others are refused at login, so a worker name can never carry markup into the website, API or logs
- `website.adminCenter.enabled` is `false` in the shipped configs; enable it after setting `passwordHash`
- A payment cycle starts within about a minute of a found block, so immature balances show it at once (before: up to `paymentInterval`); the regular schedule continues
- When an aux chain finds a block, merged jobs go out with `clean_jobs=true` so miners drop work that can no longer win it; stale aux work is no longer submitted; ESF work is refreshed on a new tip or once a minute instead of on every poll
- Block confirmation counts are updated by each coin's payment processor every `confirmationsInterval` seconds (default 120) for every coin, including aux coins; the standalone `libs/blockConfirmations.js` (hard-coded daemons, S256/BTGS missing) is removed
- Dependencies (no known vulnerabilities); Node.js 24 required — redis 3 → 6 (through `libs/redisCompat.js`, which keeps the v3 callback API and replies), express 4 → 5, archiver 7 → 8, dateformat 4 → 5; unused axios and nonce removed

### Removed

- The old client-side mining key page (`/key.html`, `mining_key`), which was never served, and unused files (`libs/workerapi.js`, old stats scripts and stylesheets)

### Fixed

- A TLS (`stratum+ssl`) or HTTP connection to a plain stratum port no longer gets the IP banned — rental services such as MiningRigRentals try TLS first and were locked out for 10 minutes
- Fee recipients (`rewardRecipients`) now take their output script from the daemon: bech32 fee addresses were skipped and P2SH fee addresses got a wrong (unspendable) script
- Coinbase timestamps from 2038-01-19 would have crashed job creation; non-ASCII `blockIdentifier`s got a wrong length; mining-key payout addresses had a double checksum
- A bare `solo` or `solo=true` password now selects solo mining in the stratum layer too, matching the payout side
- The connection count in the 5-minute stats never went down; regtest was reported as "Mainnet" at startup
- Finding a solo block reset the round shares and best share of every solo miner, not only the finder; solo hashrate samples were never trimmed from Redis
- The client IP could be faked with an `X-Forwarded-For` header to get around the API rate limit, bans and the admin login lockout; proxy headers are now trusted only from the same machine (a reverse proxy such as nginx)
- A failing `getbalance` at startup (e.g. error -19, several wallets loaded) silently left a coin's payment processing off; it is now logged
- Admin Center pool management failed to load ("value.toFixed is not a function") when a coin reported its difficulty as text

## v1.4.7

### Added

- Optional miner-configurable variable difficulty (`tt=`/`rt=`/`vp=` password params) — lets experienced miners tune their own retarget timing within operator-defined bounds, per port, off by default

### Changed

- Getting Started page documents the new tuning parameters, with a clear "most miners don't need this" framing for casual users

## v1.4.6

### Added

- Security module bans (rate limiting, malformed messages, flood detection) now actually block reconnection attempts, instead of being logged without being enforced
- Worker cards on the website now show Last Share (time + actual difficulty) and Best Share (highest difficulty this round)
- Log archives are compacted into one monthly archive instead of being deleted after 30 days

### Changed

- Graceful shutdown handling — `systemctl restart` no longer races with worker auto-respawn logic

### Fixed

- Coinbase transaction framing bug that corrupted the block's merkle root when `txMessages` was enabled — pool signature is now embedded as a standards-compliant OP_RETURN output instead of invalid trailing bytes
- `blockIdentifier` was written to shared global state, leaking one coin's identifier into every other coin's mined blocks when running multiple coins in the same process — now threaded per-coin end to end, with a byte-length safety cap
- `md=` (minimum difficulty) password parameter now correctly floors the miner's assigned difficulty instead of being silently ignored
- Immature balance display showed raw satoshis instead of coins due to a missing unit conversion in the payment processor

## v1.4.5

### Added

- Added `mining.multi_version` stratum extension for overt AsicBoost
- Admin Center with secure bcrypt password hashing

### Changed

- Enhanced stratum protocol handling

## v1.4.4

### Changed

- Security enhancements

### Fixed

- Memory optimization

## v1.4.3

### Changed

- Added Whatsminer support

## v1.4.2

### Changed

- Updated package.json dependencies

### Fixed

- Logging and added log rotation, log archive

## v1.4.1

### Changed

- Solo mining fees now correctly compensate for coinbase rewardRecipients
- Consistent fee handling for both 'generate' and 'immature' blocks
- Payment processor efficiency improvements

### Fixed

- Double fee deduction bug in solo mining payment processing
