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

### Recent Updates (v1.4.2)

* **UPDATE**: Updated package.json dependencies
* **FIXED**: Logging and added log rotation, log archive 

### Recent Updates (v1.4.1)

* **FIXED**: Double fee deduction bug in solo mining payment processing
* **IMPROVED**: Solo mining fees now correctly compensate for coinbase rewardRecipients
* **ENHANCED**: Consistent fee handling for both 'generate' and 'immature' blocks
* **OPTIMIZED**: Payment processor efficiency improvements

### Community

If your pool uses SHA256-NOMP let us know and we will list your website here.

### Some pools using SHA256-NOMP:

* [sha256-mining.go.ro - Mining Pool](https://sha256-mining.go.ro:50300)

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

    "profitSwitch": {
        "enabled": false,
        "updateInterval": 600,
        "depth": 0.90,
        "usePoloniex": true,
        "useCryptsy": true,
        "useMintpal": true
    }
}
````

##### Coin config
Inside the `coins` directory, ensure a json file exists for your coin. If it does not you will have to create it.
Here is an example of the required fields:
````javascript
{
    "name": "Bitcoin",
    "symbol": "BTC",
    "algorithm": "sha256",
    "asicboost": true,  // Enable ASICBoost with version rolling

    // Coinbase value is what is added to a block when it is mined
    "coinbase": "SHA256NOMP",
    
    /* Magic value only required for setting up p2p block notifications. */
    "peerMagic": "f9beb4d9", //optional
    "peerMagicTestnet": "0b110907" //optional

    //"txMessages": false, //optional - defaults to false
}
````

##### Pool config
Take a look at the example json file inside the `pool_configs` directory. Rename it to `bitcoin.json` and change the
example fields to fit your setup.

```
Please Note that: 1 Difficulty is actually 8192, 0.125 Difficulty is actually 1024.

Whenever a miner submits a share, the pool counts the difficulty and keeps adding them as the shares.

ie: Miner 1 mines at 0.1 difficulty and finds 10 shares, the pool sees it as 1 share. Miner 2 mines at 0.5 difficulty and finds 5 shares, the pool sees it as 2.5 shares.
```

```bitcoin.json
{
    "enabled": true,
    "coin": "bitcoin.json",
    
    "asicboost": true,  // Enable ASICBoost support with version rolling
    
    "address": "YOUR_POOL_WALLET_ADDRESS",
    
    "rewardRecipients": {
        "POOL_FEE_ADDRESS": 1.0  // 1% pool fee at coinbase level
    },

    "paymentProcessing": {
        "minConf": 101,
        "enabled": true,
        "paymentMode": "prop", // or "pplnt"
        "paymentInterval": 120,
        "minimumPayment": 0.01,
        "soloMining": true,  // Enable solo mining
        "soloFee": 2.0,      // Total fee for solo miners (2%)
        "daemon": {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "username",
            "password": "password"
        }
    },

    "ports": {
        "3032": {
            "diff": 1024,
            "varDiff": {
                "minDiff": 512,
                "maxDiff": 131072,
                "targetTime": 15,
                "retargetTime": 90,
                "variancePercent": 30
            }
        },
        "3033": {  // High difficulty port for large miners
            "diff": 16384,
            "varDiff": {
                "minDiff": 16384,
                "maxDiff": 2097152,
                "targetTime": 15,
                "retargetTime": 90,
                "variancePercent": 30
            }
        }
    },

    "daemons": [
        {
            "host": "127.0.0.1",
            "port": 8332,
            "user": "username",
            "password": "password"
        }
    ],

    "p2p": {
        "enabled": false,
        "host": "127.0.0.1",
        "port": 8333,
        "disableTransactions": true
    }
}
```

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

#### 3) Start the portal

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