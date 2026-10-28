# Upgrading SHA256-NOMP

Release notes for every version are in the [Changelog](../CHANGELOG.md). Back to the [README](../README.md).

When updating SHA256-NOMP to the latest code its important to not only `git pull` the latest from this repo, but to also update
the `node-stratum-pool` module, and any config files that may have been changed.

- Inside your SHA256-NOMP directory (where the init.js script is) do `git pull` to get the latest SHA256-NOMP code.
- Remove the dependencies by deleting the `node_modules` directory with `rm -r node_modules`.
- Run `npm update` to force updating/reinstalling of the dependencies.
- Compare your `config.json` and `pool_configs/coin.json` configurations to the latest example ones in this repo or the ones in the [Configuration](configuration.md) guide where each config field is explained. <b>You may need to modify or add any new changes.</b>

## From 1.4.x to 1.5.0

Node.js 24+ and Redis 6.2+ are required; usernames with characters other than letters, digits, `.`, `_` and `-` are refused; the admin center ships disabled; merged mining is configured per parent pool (`mergedMining`, see [Merged Mining](merged-mining.md)) and every aux coin needs its own pool config. Redis data from 1.4.x is kept.

## From 1.5.x to 1.6.0 (S256 merged mining live)

No code or config format changes. S256 passed its AuxPoW fork at block 17,500, so S256 can now be merge-mined. `pool_configs/` is never overwritten by an update: to merge-mine S256 on a running pool, add `auxCoins.sha256coin` to each parent pool config and put `sha256coin` in its `standard` group (see [Merged Mining](merged-mining.md)), check that `pool_configs/sha256coin.json` has `paymentProcessing.soloMining` on, then restart the portal. The S256 node must run S256 Core v3.0.1 or later.

## From 1.5.0 to 1.5.1 (ElevenSeventyFive)

With ElevenSeventyFive (ESF) configured, its pool ID changed from `esf1175coin` to `elevenseventyfive`. With the pool stopped and a Redis backup taken, rename `coins/esf1175coin.json` and `pool_configs/esf1175coin.json` to `elevenseventyfive.json` (and their `name` / `coin` fields), rename the aux coin key `esf1175coin` in every parent pool config (`mergedMining.auxCoins` and `groups`), change the ESF daemon's `blocknotify` to `... blocknotify elevenseventyfive %s` and restart it, then run `node scripts/rename-coin-redis.js esf1175coin elevenseventyfive` (dry run) and again with `--apply`. Pending ESF blocks and balances move with the data.
