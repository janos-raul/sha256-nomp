# Miner Options

What miners can set from their side: solo mining, the stratum password parameters, their own vardiff timing (where the port allows it) and `mining.multi_version`. Back to the [README](../README.md).

## Solo Mining

Miners connect for solo mining using the password parameter:

```
Username: YOUR_BITCOIN_ADDRESS
Password: m=solo
```

A worker name can follow the address (`YOUR_BITCOIN_ADDRESS.rig1`). Usernames may only use letters, digits, `.`, `_` and `-`; the pool refuses others at login.

Example connections:

- **CGMiner**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo`
- **With custom difficulty**: `cgminer -o stratum+tcp://yourpool.com:3032 -u YOUR_ADDRESS -p m=solo,d=65536`

## Password Parameters

Miners can pass one or more of the following via the stratum password field, comma-separated:

| Parameter    | Description                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m=solo`     | Mine solo instead of pool mode (a bare `solo` or `solo=true` works too)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `d=<value>`  | Set the miner's _starting_ difficulty immediately on connect, overriding the port's configured default                                                                                                                                                                                                                                                                                                                                  |
| `md=<value>` | Set a _minimum_ difficulty floor — variable difficulty will retarget freely above this value but will never drop the miner below it, even if their share timing suggests it should. Useful for large ASICs (S19/S21/T21-class) to reduce unnecessary share traffic. The floor is clamped between the port's own `minDiff` and `maxDiff`, so it can raise the effective floor but can never push it above the port's configured ceiling. |
| `tt=<value>` | Requested varDiff target time (seconds between shares). Only takes effect on ports with `minerConfigurable.targetTime` set; clamped to that range. Ignored (falls back to the port default) otherwise. |
| `rt=<value>` | Requested varDiff retarget time (seconds between adjustments). Only takes effect on ports with `minerConfigurable.retargetTime` set; clamped to that range. Ignored otherwise. |
| `vp=<value>` | Requested varDiff variance percent. Only takes effect on ports with `minerConfigurable.variancePercent` set; clamped to that range. Ignored otherwise. |
| `s256=<address>`, `esf=<address>`, … | Merged mining payout address for an aux coin; the key is that coin's `addressParam`. Only used by solo miners on ports with an `auxGroup`. Checked with the coin's daemon at login; an invalid address refuses the login. See [Merged Mining](merged-mining.md). |

Example: `-p m=solo,d=1000000,md=500000` starts the miner at difficulty 1,000,000 and guarantees it never retargets below 500,000.

## Miner-Configurable VarDiff (tt=/rt=/vp=)

For experienced miners who know their own hashrate, a port can optionally let miners tune how their own
variable difficulty behaves, instead of only using the operator's fixed per-port settings. This is
**off by default** — a port only accepts `tt=`/`rt=`/`vp=` if its config explicitly includes a
`varDiff.minerConfigurable` block (see the `50212` example under [Pool config](configuration.md#pool-config) in the Configuration guide).

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

## Multi-Version Support (mining.multi_version)

SHA256-NOMP supports the `mining.multi_version` stratum extension for overt AsicBoost mining. This is an alternative to `mining.configure` version rolling.

### Enabling Multi-Version

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

### How It Works

1. Miner sends: `{"method": "mining.multi_version", "params": [4]}`
2. Pool responds with `result: true` if enabled
3. Pool sends jobs with multiple versions in `mining.notify`
4. Miner can use any of the provided versions for share submission

### Miner Compatibility

Miners supporting `mining.multi_version`:

- Custom firmware with multi_version support
- Some Bitmain firmware variants
- Mining proxies with multi_version capability
