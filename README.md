# SHA256-NOMP - Node Open Mining Portal

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

This is a SHA256 mining pool with solo mining support and ASICBoost with version rolling, based on Node Open Mining Portal.

#### Production Usage Notice

This is beta software. All of the following are things that can change and break an existing SHA256-NOMP setup: functionality of any feature, structure of configuration files and structure of redis data. If you use this software in production then _DO NOT_ pull new code straight into production usage because it can and often will break your setup and require you to tweak things like config files or redis data. _Only tagged releases are considered stable._

#### Paid Solution

Usage of this software requires abilities with sysadmin, database admin, coin daemons, and sometimes a bit of programming. Running a production pool can literally be more work than a full-time job.

### Features

- ✅ **Solo Mining Support** - Miners can mine solo with `m=solo` password parameter ([Miner Options](guides/miner-options.md))
- ✅ **ASICBoost Support** - Full support with version rolling for mining optimization
- ✅ **Multi-Version Support** - `mining.multi_version` extension for overt AsicBoost ([Miner Options](guides/miner-options.md#multi-version-support-miningmulti_version))
- ✅ **Fixed Payment System** - Resolved double fee deduction issue (v1.4.1)
- ✅ **Multiple Payment Modes** - PROP and PPLNT payment systems ([Configuration](guides/configuration.md#pool-config))
- ✅ **Dual Mining** - Support pool and solo mining simultaneously
- ✅ **Admin Center** - Web-based administration panel with secure bcrypt authentication ([Admin Center](guides/admin-center.md))
- ✅ **Merged Mining for Solo Miners** - Solo miners merge-mine aux coins (e.g. S256, ESF, VMESH) on the same work, each paid to their own address (v1.5.0, [Merged Mining](guides/merged-mining.md))

### What's New

Latest release: **v1.5.6**. Release notes for every version are in the [Changelog](CHANGELOG.md); see [Upgrading](guides/upgrading.md) before updating a running pool.

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
- ✅ Merged mining for solo miners: S256 on every coin except S256 and ESF themselves; Bitcoin Silver ports 50222–50226 also merge-mine VMESH, and port 50227 merge-mines ESF (see [Merged Mining](guides/merged-mining.md))

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

- **config.json** - Main portal configuration (copy `config_example.json` and edit it)
- **coins/\*.json** - Coin-specific configurations (blockchain settings)
- **pool_configs/\*.json** - Pool operational configurations (ports, fees, payments)

Every field, the fee setup and the payment modes are explained in the [Configuration](guides/configuration.md) guide. Point each coin daemon's `blocknotify` at the portal so new blocks reach miners at once (see [Block notifications](guides/configuration.md#block-notifications-blocknotify)):

```
blocknotify=node /home/user/sha256-nomp/scripts/cli.js blocknotify bitcoin %s
```

#### 3) Start the portal

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

### Guides

- [Configuration](guides/configuration.md) - portal, coin and pool configs, fees, payment modes, blocknotify, block confirmations
- [Miner Options](guides/miner-options.md) - solo mining, password parameters (`m=solo`, `d=`, `md=`, `tt=`/`rt=`/`vp=`), `mining.multi_version`
- [Merged Mining](guides/merged-mining.md) - aux coins for solo miners (S256, ESF, VMESH): miner and operator setup
- [Admin Center](guides/admin-center.md) - web administration panel and password hash setup
- [Upgrading](guides/upgrading.md) - updating a running pool, version-specific steps
- [Changelog](CHANGELOG.md) - release notes

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
