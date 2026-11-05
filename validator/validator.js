// VeriMash independent validator.
//
// Each teammate runs ONE copy of this on their own laptop, with:
//   - their own private key (never shared, never sent anywhere)
//   - their own RPC provider for Chain A and Chain B
//
// What it does, on a loop:
//   1. Reads new MessageSent events from Chain A through ITS OWN RPC.
//   2. Waits for N confirmations (protects against short reorgs).
//   3. Re-checks the evidence itself: receipt succeeded, block hash still canonical,
//      event really came from the VeriMashSource contract, destination is our Chain B.
//   4. Submits its own attest() vote to the gate on Chain B, from its own key.
//      The vote covers the sender, the RECIPIENT and the exact message.
// The gate delivers the message only when 2 of 3 validators have voted for the same content.
//
// Usage:  npm run validator -- --env validator1.env
const path = require("path");
const { artifact, loadDeployment, loadEnvFile, feeOverrides, reason, sleep, ethers } = require("../lib/common");

const argEnv = (() => { const i = process.argv.indexOf("--env"); return i > 0 ? process.argv[i + 1] : null; })();
loadEnvFile(argEnv ? path.resolve(argEnv) : path.join(process.cwd(), ".env"));

const C = { reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m", bold: "\x1b[1m" };

async function runValidator(cfg = {}) {
  const key = cfg.key || process.env.VALIDATOR_KEY;
  const deployment = cfg.deployment || loadDeployment(process.env.DEPLOYMENT);
  const sourceRpc = cfg.sourceRpc || process.env.SOURCE_RPC || deployment.chainA.rpc;
  const destRpc = cfg.destRpc || process.env.DEST_RPC || deployment.chainB.rpc;
  const confirmations = Number(cfg.confirmations ?? process.env.CONFIRMATIONS ?? deployment.confirmations ?? 2);
  const pollMs = Number(cfg.pollMs ?? process.env.POLL_MS ?? 4000);
  let chunk = Number(cfg.chunk ?? process.env.LOG_CHUNK ?? 2000);
  const name = cfg.name || process.env.VALIDATOR_NAME || "validator";
  const quiet = !!cfg.quiet;
  const log = (...a) => { if (!quiet) console.log(`${C.dim}${new Date().toLocaleTimeString()}${C.reset} ${C.bold}[${name}]${C.reset}`, ...a); };

  if (!key) throw new Error("VALIDATOR_KEY is not set. Run `npm run keygen` and put the key in your validator .env file.");

  const src = new ethers.JsonRpcProvider(sourceRpc);
  const dst = new ethers.JsonRpcProvider(destRpc);
  const wallet = new ethers.Wallet(key, dst);
  const S = artifact("VeriMashSource"), G = artifact("VeriMashGate");
  const source = new ethers.Contract(deployment.chainA.source, S.abi, src);
  const gate = new ethers.Contract(deployment.chainB.gate, G.abi, wallet);

  const [netA, netB] = await Promise.all([src.getNetwork(), dst.getNetwork()]);
  if (Number(netA.chainId) !== deployment.chainA.chainId) throw new Error(`SOURCE_RPC is chain ${netA.chainId}, expected ${deployment.chainA.chainId}`);
  if (Number(netB.chainId) !== deployment.chainB.chainId) throw new Error(`DEST_RPC is chain ${netB.chainId}, expected ${deployment.chainB.chainId}`);
  if (!(await gate.isValidator(wallet.address))) throw new Error(`${wallet.address} is not in the gate's validator set. Check your VALIDATOR_KEY.`);

  log(`${C.cyan}online${C.reset} as ${wallet.address}`);
  log(`Chain A ${deployment.chainA.name} via ${new URL(sourceRpc).host}, Chain B ${deployment.chainB.name} via ${new URL(destRpc).host}`);
  log(`waiting for ${confirmations} confirmation(s), gas balance ${ethers.formatEther(await dst.getBalance(wallet.address))} ${deployment.chainB.currency}`);

  const iface = source.interface;
  const topic = iface.getEvent("MessageSent").topicHash;
  let next = Number(process.env.START_BLOCK || deployment.chainA.deployBlock);
  let stopped = false;

  async function verifyAndVote(lg) {
    const ev = iface.parseLog(lg);
    const nonce = ev.args.nonce, sender = ev.args.sender, destChainId = ev.args.destChainId, recipient = ev.args.recipient, message = ev.args.message;
    const tag = `#${nonce} "${message.length > 40 ? message.slice(0, 40) + "…" : message}"`;

    if (Number(destChainId) !== deployment.chainB.chainId) return log(`${C.dim}skip ${tag}: addressed to chain ${destChainId}${C.reset}`);

    // --- Independent evidence check, through this validator's own RPC ---
    const receipt = await src.getTransactionReceipt(lg.transactionHash);
    if (!receipt || receipt.status !== 1) return log(`${C.red}REJECT ${tag}: source tx failed or missing${C.reset}`);
    const block = await src.getBlock(lg.blockNumber);
    if (!block || block.hash !== lg.blockHash || receipt.blockHash !== lg.blockHash)
      return log(`${C.yellow}hold ${tag}: block hash changed (reorg?) — will re-read${C.reset}`), "retry";
    const inReceipt = receipt.logs.some((l) =>
      l.address.toLowerCase() === deployment.chainA.source.toLowerCase() &&
      l.index === lg.index && l.data === lg.data && l.topics.join() === lg.topics.join());
    if (!inReceipt) return log(`${C.red}REJECT ${tag}: event not found in receipt${C.reset}`);

    // --- Already handled? ---
    const k = await gate.messageKey(nonce, sender, recipient, message);
    if (await gate.hasVoted(k, wallet.address)) return; // our vote is already on chain
    const done = await gate.deliveredKeyForNonce(nonce);
    if (done !== ethers.ZeroHash && done !== k) return log(`${C.red}REJECT ${tag}: different content already delivered for this nonce${C.reset}`);

    // --- Vote ---
    log(`verified ${tag} from ${sender.slice(0, 8)}… to ${recipient.slice(0, 8)}… in block ${lg.blockNumber} → attesting on Chain B`);
    try {
      // Gas buffer: if another validator's vote lands first, ours may become the one that
      // triggers delivery (more storage writes) — so never send with a tight estimate.
      const est = await gate.attest.estimateGas(nonce, sender, recipient, message);
      const gasLimit = est * 2n + 150000n + 25000n * BigInt(Math.ceil(Buffer.byteLength(message) / 32));
      const tx = await gate.attest(nonce, sender, recipient, message, { gasLimit, ...(await feeOverrides(dst)) });
      const r = await tx.wait();
      const att = r.logs.map((l) => { try { return gate.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
      const votes = att.find((e) => e.name === "Attested")?.args.votes;
      const delivered = att.some((e) => e.name === "MessageDelivered");
      log(`${C.green}✓ vote recorded${C.reset} ${tag} — ${votes} vote(s), ${deployment.threshold} needed${delivered ? ` ${C.green}${C.bold}→ DELIVERED on Chain B, waiting for the recipient to accept${C.reset}` : ""} (tx ${r.hash.slice(0, 12)}…)`);
    } catch (e) {
      const why = reason(e);
      if (/already attested/i.test(why)) return;
      log(`${C.red}vote failed for ${tag}: ${why}${C.reset}`);
      return "retry";
    }
  }

  (async function loop() {
    while (!stopped) {
      try {
        const head = await src.getBlockNumber();
        const safeHead = head - confirmations + 1; // a block at safeHead has `confirmations` confirmations
        if (safeHead >= next) {
          const to = Math.min(safeHead, next + chunk - 1);
          let logs;
          try {
            logs = await src.getLogs({ address: deployment.chainA.source, topics: [topic], fromBlock: next, toBlock: to });
          } catch (e) {
            // Free RPC plans (e.g. Alchemy free = 10 blocks) limit getLogs ranges, often with an unclear
            // error like "could not coalesce error". Shrink the window and retry straight away.
            if (chunk > 10) {
              chunk = Math.max(10, Math.floor(chunk / 4));
              log(`${C.yellow}RPC refused a ${to - next + 1}-block log query — now scanning ${chunk} blocks at a time${C.reset}`);
              continue;
            }
            throw e;
          }
          let retry = false;
          for (const lg of logs) if ((await verifyAndVote(lg)) === "retry") { retry = true; break; }
          if (!retry) next = to + 1;
          if (to < safeHead) continue; // still catching up, no sleep
        }
      } catch (e) {
        const why = reason(e);
        // Free RPC plans limit how many blocks one getLogs call may cover. Shrink and retry.
        if (/range|limit|too many|exceed|10 block/i.test(why) && chunk > 10) {
          chunk = Math.max(10, Math.floor(chunk / 4));
          log(`${C.yellow}RPC limits log range — scanning ${chunk} blocks at a time${C.reset}`);
          continue;
        }
        log(`${C.yellow}RPC problem: ${why} — retrying${C.reset}`);
      }
      await sleep(pollMs);
    }
  })();

  return { address: wallet.address, stop: () => { stopped = true; src.destroy(); dst.destroy(); } };
}

module.exports = { runValidator };

if (require.main === module) {
  runValidator().catch((e) => { console.error(`${C.red}${e.message}${C.reset}`); process.exit(1); });
}
