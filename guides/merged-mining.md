# Merged Mining (Solo Miners)

Back to the [README](../README.md). Pool configuration fields are in [Configuration](configuration.md).

Solo miners can merge-mine aux coins on the same work as the parent coin (Namecoin-style AuxPoW). Pool-mode miners are not affected: they always get plain parent jobs.

**For miners** — mine solo on a merged-mining port and add an address for each aux coin you want paid:

```
Username: YOUR_PARENT_COIN_ADDRESS.worker
Password: m=solo,s256=YOUR_S256_ADDRESS
```

If you leave out an aux coin's address, its blocks are still found and submitted, but the reward stays in the pool wallet.

**For operators** — in the parent coin's pool config (the example configs for BTC, BTCS, BTG, BC2 and Mytherra ship with S256 merged mining enabled):

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

- **S256** accepts merge-mined blocks from its block 17,500 (its AuxPoW hard fork). The S256 node must run S256 Core v3.0.1 or later: 3.0.0 used a different auxpow format and chain ID, and older versions are stuck on the pre-fork chain. S256 (chain ID 598) and VMESH (22093) share the `standard` group in a 2-slot tree.
- `auxPollInterval` (ms) is how often each parent pool asks the aux nodes for new work. Point each aux node's `blocknotify` at the portal like a parent coin's (`blocknotify=/usr/bin/node /path/to/sha256-nomp/scripts/cli.js blocknotify <aux pool name> %s`): every parent pool that merge-mines that coin then fetches the new aux work at once and sends it with `clean_jobs`, so miners don't keep hashing (up to `auxPollInterval`) on an aux tip that is already gone; blocks found on it are orphaned ("inconclusive"). The poll stays as a fallback.
- `enabled: false` turns merged mining off on every port; a port without `auxGroup` mines the parent coin only.
- **Each aux coin needs its own pool config** (e.g. `pool_configs/sha256coin.json`) with `paymentProcessing.enabled` and `paymentProcessing.soloMining` on, using the same daemon/wallet and pool address as in `auxCoins`. Merged-mined blocks are recorded there as solo blocks of the miner's aux address, and that pool's payment processor pays the finder (minus its `soloFee`) once the block matures. The portal refuses to start if this config is missing.
- Namecoin-standard coins (S256, Namecoin, …) can share a group: add the coin to `auxCoins` and its name to the group. A coin with `byteOrder: "reversed"` or `slotRule: "modulo"` must be alone in its own group, on its own port(s).
- **ESF example** (`pool_configs/bitcoinsilver.json`): `auxCoins.elevenseventyfive` (ElevenSeventyFive, chain ID 1175, `byteOrder: "reversed"`, `slotRule: "modulo"`, `addressParam: "esf"`) in group `esf`, used by port **50227** — solo miners there mine BTCS + ESF with `m=solo,esf=<ESF address>`, while ports 50222–50226 mine BTCS + S256. ESF's own pool config is `pool_configs/elevenseventyfive.json` (coin file `coins/elevenseventyfive.json`; its `displayName` "ElevenSeventyFive" is what the website and API show — the optional `displayName` field works for any coin file, otherwise the capitalized pool name is shown), which pays the ESF solo blocks. ESF has no `createauxblock`; the pool uses `getauxblock` automatically. ESF accepts merge-mined blocks from its block 31733.
- **VargaMesh example** (`pool_configs/bitcoinsilver.json`): `auxCoins.vargamesh` (VMESH, chain ID 22093 = `0x564D`, `addressParam: "vmesh"`, `mode: "getblocktemplate"`) shares the `standard` group with S256, so solo miners on ports 50222–50226 mine BTCS + S256 + VMESH with `m=solo,s256=<S256 address>,vmesh=<VMESH address>`. VargaMesh requires AuxPoW from block 1, so it can only be merge-mined: its own pool config `pool_configs/vargamesh.json` has no ports and only records and pays the blocks.
- `mode` selects how the pool gets aux work: `auxblock` (default) uses the node's `createauxblock`/`getauxblock` and `submitauxblock`; `getblocktemplate` is for nodes without those RPCs (VargaMesh) — the pool builds the aux block from `getblocktemplate` (coinbase paying `address`, witness commitment, the node's `auxpow_childnonce`) and submits header + auxpow + transactions with `submitblock`. The node must report `auxpow: true` and the configured chain ID.
- With merged mining on, `blockIdentifier` is capped at 30 bytes to keep the coinbase scriptSig within 100 bytes.
- Every aux block is logged (`[AUX BLOCK FOUND!]`) and listed in Redis under `<coin>:auxBlocks:<auxcoin>`.
- `/api/stats` shows merged mining per coin: `merged_with` in the YIIMP-style shape pool listing sites read (`{"merged_with": "S256,ESF"}`, or `"0"`), `merge_mined_by` on aux coins (e.g. `["BTCS"]`), and `mergedMining` with each aux coin's symbol, chain ID, ports and password example.
