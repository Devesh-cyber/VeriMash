# VeriMash v2

**Decentralised cross-chain message verification. No trusted relay, no admin, no server in the middle.**

**Two people, two wallets, two blockchains.** Person 1 sends a message from their own wallet on **Blockchain A** (Ethereum Sepolia) and names Person 2's wallet. Three **independent validators**, each on a different laptop with its own key and its own RPC provider, read Chain A by themselves and vote directly on **Blockchain B**. The contract on Chain B delivers the message to Person 2 only when **2 of 3** agree on the exact same content, sender and recipient. Then **only Person 2** can accept it, signing on Chain B with their own wallet.

## What changed from v1

| v1 weakness | v2 fix |
|---|---|
| Backend relay carried every message (central middleman) | **No relay at all.** Each validator submits its own vote straight to Chain B. The contract counts votes itself. |
| Backend held all 3 validator keys | Each key lives only on its owner's laptop (`npm run keygen`). |
| One trusted RPC for evidence | Each validator uses its own provider (Alchemy / Infura / public). |
| Local Hardhat chains that reset | Real public testnets: Sepolia → Amoy. Every step is visible on Etherscan / Polygonscan. |
| Backend sent the transaction for the user | User signs in their own MetaMask (works on phones). |
| No finality handling | Validators wait N confirmations and re-check the block hash (reorg-aware). |
| "Bob" was just text inside the message | A **real recipient wallet** is part of every vote, and only that wallet can `accept()` on Chain B. |

## How it works

```
 Phone 1 (MetaMask)                 3 laptops (validators)                    Phone 2
        │                    each with own key + own RPC                         │
        ▼                                                                         ▼
 ┌──────────────┐   reads events    ┌─────────────┐   attest() vote   ┌────────────────┐
 │ Chain A      │ ───────────────▶  │ Validator 1 │ ───────────────▶  │ Chain B        │
 │ Sepolia      │ ───────────────▶  │ Validator 2 │ ───────────────▶  │ Polygon Amoy   │
 │ VeriMash-    │ ───────────────▶  │ Validator 3 │ ───────────────▶  │ VeriMashGate   │
 │ Source       │                   └─────────────┘                   │ 2 of 3 → deliver│
 └──────────────┘                                                     └────────────────┘
```

1. **Send (Person 1, Chain A).** Calls `VeriMashSource.sendMessage(destChainId, recipient, message)` from their own wallet. It emits `MessageSent(nonce, sender, destChainId, recipient, message)`.
2. **Verify.** Each validator independently waits for confirmations, re-reads the receipt, checks the block hash is still canonical, and checks the event really came from the source contract.
3. **Vote.** Each validator calls `VeriMashGate.attest(nonce, sender, recipient, message)` on Chain B from its own key.
4. **Deliver.** The vote is bound to `(chainA, sourceContract, chainB, gate, nonce, sender, recipient, hash(message))`. When 2 validators vote for the same key, the gate emits `MessageDelivered` for that recipient. Exactly once.
5. **Accept (Person 2, Chain B).** The recipient calls `VeriMashGate.accept(nonce)` from their own wallet. Anyone else gets `Gate: only the recipient can accept`.

## Project structure

```
contracts/VeriMashSource.sol      Chain A: user sends messages here
contracts/VeriMashGate.sol        Chain B: counts validator votes, delivers at threshold
validator/validator.js            The validator each teammate runs on their own laptop
validator/validator.env.example   Template for one validator's settings
frontend/index.html               Landing page (v1 design, v2 wording)
frontend/app.html + app.js        The app, v1 layout: Overview, Workspace, My Inbox (receiver),
                                  Validators, Explorer, Security Lab, Live Demo. No backend.
scripts/deploy.js                 Deploys both contracts, writes deployment.json + frontend/config.js
scripts/local.js                  One-command local stack (2 chains + 3 validators + web app)
scripts/attack.js                 Security Lab: tries 5 attacks, shows each is rejected
scripts/test-e2e.js               Full end-to-end test
scripts/keygen.js                 Makes a new validator wallet
scripts/fund-local.js             npm run fund -- 0xAddr…  → 100 coins on your LOCAL Chain B
```

---

## Part 1 — Run it locally (5 minutes, no tokens needed)

Needs **Node.js 18+** (`node --version`).

```bash
unzip verimash-v2.zip && cd verimash-v2
npm install          # also compiles the contracts
npm test             # full end-to-end test, should end with "All checks passed"
npm run local        # starts 2 chains + 3 validators + web app
```

Open **http://localhost:8080** and click **Open application**. In local mode, without MetaMask, the app uses two built-in demo wallets automatically: Person 1 (sender) and Person 2 (receiver, pre-filled as the recipient). After sending, open **My Inbox** → **Connect receiver wallet** → **Accept**. Go to **Transaction Workspace** or **Live Transaction Demo**, press send, and watch the five-stage journey fill in live while the validator logs scroll in the terminal. Then look at **Validators** (vote matrix), **Explorer** (full proof per message) and **Security Lab** (four attacks against the live contract).

In a second terminal, while `npm run local` is running:

```bash
npm run attack       # Security Lab
```

A phone on the same Wi-Fi can open the "On Wi-Fi" address that `npm run local` prints, for example `http://192.168.1.5:8080/app.html#explorer`.

### What changed in the app compared to v1

Same landing page, sidebar, five sections and styling. Underneath:

| v1 app | v2 app |
|---|---|
| `POST /api/send` to our backend | You sign in MetaMask (top-right **Connect wallet**) |
| Journey filled in after the server finished | Journey updates **live**, stage by stage, straight from both chains |
| "Relayed by trusted relay" stage | "Independent validators verify" + "Threshold reached on Chain B" |
| Explorer showed source tx only for your latest message | Every record shows source tx, **each validator's vote tx**, delivery tx |
| Security Lab called backend test routes | Security Lab runs read-only `eth_call`s against the real deployed gate |
| Startup screen waited for Render to wake | Startup screen just waits until both chains answer |
| — | **New Validators page**: each validator's status, votes, gas, and the vote matrix |
| "Bob" only existed in the text | **Recipient field** + new **My Inbox** page where the receiver accepts with their own wallet; a 6th journey stage "Accepted by the recipient" |

---

## Part 1b — Solo test with the real Sepolia (Chain B on your laptop)

This is the setup that already worked: Chain A is the real Sepolia, Chain B runs on your laptop (unlimited free coins), and three validators run in three terminals.

```bash
# Terminal 1: Chain B (keep it open; closing it wipes Chain B)
cd hardhat && npx hardhat --config chainB.config.js node --hostname 0.0.0.0 --port 8546
```
```bash
# Terminal 2: give coins on Chain B to the deployer, the 3 validators AND the receiver wallet
npm run fund -- BOSS_ADDR V1_ADDR V2_ADDR V3_ADDR RECEIVER_ADDR
```
`.env`: `CHAIN_A_RPC=<your Alchemy Sepolia URL>`, `CHAIN_B_RPC=http://127.0.0.1:8546`, `DEPLOYER_KEY=<boss private key>` (needs ~0.01 Sepolia ETH), `VALIDATORS=<3 addresses>`. Then `npm run deploy:testnet`.

Each validator env file (`validator/v1.env`, `v2.env`, `v3.env`): its own `VALIDATOR_KEY`, `SOURCE_RPC=<Alchemy Sepolia URL>`, `DEST_RPC=http://127.0.0.1:8546`, and **`LOG_CHUNK=10`** (Alchemy's free plan only allows 10-block log queries). Start each with `npm run validator -- --env validator/v1.env`, then `npm run serve` and open http://localhost:8080.

**Two people with one MetaMask (solo test):** use two MetaMask accounts.
- **Sender** = the account with Sepolia ETH (e.g. "Imported Account 1"). In **Transaction Workspace**, paste the **receiver account's address** in the recipient field and send. MetaMask switches to Sepolia.
- **Receiver** = another account (e.g. "Account 1"). Give it Chain B coins: `npm run fund -- <its address>`. Switch MetaMask to that account, open **My Inbox**, click **Connect receiver wallet** (MetaMask adds/switches to "Local Chain B"; approve), then **Accept**. Make sure the localhost site is connected to that account (MetaMask → Permissions → localhost:8080).

> ⚠ Anything deployed before the recipient update must be **redeployed** (`npm run deploy:testnet`) — the contracts changed.

---

## Part 2 — The real demo on public testnets

### Step 1: everyone (all 3 teammates)

```bash
npm install
npm run keygen
```

- Send **only the Address** to whoever deploys.
- Keep the **Private key** yourself:
  ```bash
  cp validator/validator.env.example validator/validator.env
  nano validator/validator.env      # paste your VALIDATOR_KEY, set your name and RPCs
  ```
- Use a **different RPC provider** from your teammates (one Alchemy, one Infura, one public). Free keys at alchemy.com and infura.io.

### Step 2: get free test tokens

| Wallet | Needs |
|---|---|
| Deployer | a little **Sepolia ETH** and a little **Amoy POL** |
| Each validator address | a little **Chain B gas** (it votes on Chain B) |
| Receiver's MetaMask (phone 2) | a little **Chain B gas** (to accept) |
| Sender's MetaMask (phone 1) | a little **Sepolia ETH** |

Faucets: Google Cloud Web3 faucet (Sepolia, just a Google login). Amoy faucets are unreliable, so the recommended Chain B is **Base Sepolia** (chain ID 84532): get Sepolia ETH from the Google faucet and move some to Base Sepolia with Base's official Sepolia bridge (linked from docs.base.org). Then set `CHAIN_B_RPC=https://sepolia.base.org` (or an Alchemy Base Sepolia URL). The code needs no changes; the app labels and explorer links switch automatically. Some faucets ask for a small real mainnet balance or a login, and most limit amounts per day, so collect tokens **a day early** and pool them.

### Step 3: deploy (one person)

```bash
cp .env.example .env
nano .env       # DEPLOYER_KEY, the 3 VALIDATORS addresses, names, RPCs
npm run deploy:testnet
```

This writes `deployment.json` and `frontend/config.js`. Commit and push both so teammates and Vercel get them:

```bash
git add deployment.json frontend/config.js && git commit -m "Deploy v2 to Sepolia + Amoy" && git push
```

### Step 4: start validators (each teammate, on their own laptop)

```bash
git pull
npm run validator -- --env validator/validator.env
```

You should see `online as 0x…` with your gas balance. Leave it running.

### Step 5: host the web app

Import the repo on **vercel.com**, set **Root Directory = `frontend`**, framework **Other**, no build command. You get an https link that works on phones. The app is plain static files: it reads both chains through public RPCs in the browser, so there is no server to keep awake (unlike v1's Render backend).

For a public link, **both chains must be public** (e.g. Sepolia → Base Sepolia). A Chain B on your laptop only works for people on your Wi-Fi.

**Who keeps the validators running?** For the live presentation: three teammates' laptops (best visual: close a lid on stage). If judges will try the link on their own later, run the three validators on any always-on machine instead (e.g. three free cloud instances, or one teammate's PC left on), each still with its own key and RPC.

### Step 6: demo script (2 minutes)

1. **Phone 1** opens the Vercel link **inside the MetaMask app browser**, opens the **Live Transaction Demo**, pastes **Bob's wallet address** (phone 2), and sends "Invoice INV-2048 paid by Alice".
2. All 3 laptop terminals print `verified … → attesting`. The journey shows the votes filling in.
3. **Phone 2** (Bob, his own MetaMask) opens **My Inbox** → **Connect receiver wallet**. The message appears with a badge; he taps **Accept** and signs on Chain B. Phone 1's journey flips to **"Accepted by recipient"**. Show the full proof in **Explorer** → View.
4. **Close one laptop lid.** Send again. Still delivered, because 2 of 3 is enough.
5. **Close a second lid.** Send again. It sits at **1 vote, NOT delivered** — show it on the **Validators** page vote matrix.
6. **Open a lid again.** That validator catches up and the message is delivered. Decentralisation, live.
7. Run `npm run attack` on screen to show forgery, double-voting, tampering and replay all rejected.

---

## Security Lab (`npm run attack`)

| Attack | Result |
|---|---|
| A non-validator (hacker, relayer, our own server) calls `attest` | Rejected: `Gate: not a validator` |
| One corrupt validator votes for a message that never happened on Chain A | Stuck at 1 vote, never delivered |
| Re-route a delivered message to the attacker's wallet | Rejected: `Gate: conflicting message for delivered nonce` |
| A stranger calls `accept()` on someone else's message | Rejected: `Gate: only the recipient can accept` |
| That validator votes twice to fake a majority | Rejected: `Gate: validator already attested` |
| Change one character of a delivered message | Rejected: `Gate: conflicting message for delivered nonce` |
| Replay a delivered message | Rejected: `Gate: validator already attested` |

On testnets, set `ATTACKER_KEY` (any wallet with Amoy gas, not a validator) and `ROGUE_VALIDATOR_KEY` in `.env` first.

## Troubleshooting

| Problem | Fix |
|---|---|
| `is not in the gate's validator set` | Your `VALIDATOR_KEY` doesn't match an address given at deploy time. Re-check, or redeploy with the right addresses. |
| `insufficient funds` when voting | Fund your validator address with Amoy POL. |
| `RPC limits log range` | Normal on free RPC plans. It shrinks automatically, or set `LOG_CHUNK=10`. |
| App says "not deployed yet" | `frontend/config.js` is missing. Deploy, or run `npm run local`. |
| Pills show "offline" | The public RPC is busy. Wait, or set `BROWSER_RPC_A/B` in `.env` and redeploy. |
| Phone says "No wallet found" | Open the page inside the MetaMask app's built-in browser, not Chrome. |
| `EADDRINUSE` on 8545/8546/8080 | An old run is still going: `pkill -f hardhat; pkill -f local.js` |
| Amoy transaction stuck | Amoy needs a ≥25 gwei tip. The scripts set 30 gwei automatically. |

## Honest limitations (good for the PPT)

- The validator set is fixed at deployment. In production it would rotate by validator vote.
- Validators are honest-majority: if 2 of 3 collude they can approve a fake message. Next step: **staking + slashing**, so signing a fake costs money, and/or **on-chain receipt proofs** (light client), so validators only vouch for block headers.
- Testnets only. No real assets move.

**Team Proto** · VecnaVerse 2026
