// Security Lab: tries to break VeriMash and shows that Chain B refuses each attack.
//
//   npm run attack
//
// Local mode uses the Hardhat dev accounts automatically. On testnets, set in .env:
//   ATTACKER_KEY         any wallet with a little gas on Chain B (NOT a validator)
//   ROGUE_VALIDATOR_KEY  one validator's key, to show a single "corrupt" validator can't deliver alone
const path = require("path");
const { ROOT, artifact, loadDeployment, loadEnvFile, feeOverrides, reason, ethers } = require("../lib/common");
const { devKey } = require("./local");

loadEnvFile(path.join(ROOT, ".env"));
const G = { r: "\x1b[0m", g: "\x1b[32m", red: "\x1b[31m", b: "\x1b[1m", d: "\x1b[2m", y: "\x1b[33m" };

async function runAttacks({ deployment, attackerKey, rogueKey, print = true } = {}) {
  deployment = deployment || loadDeployment();
  attackerKey = attackerKey || process.env.ATTACKER_KEY || (deployment.local ? devKey(5) : null);
  rogueKey = rogueKey || process.env.ROGUE_VALIDATOR_KEY || (deployment.local ? devKey(1) : null);
  if (!attackerKey || !rogueKey) throw new Error("Set ATTACKER_KEY and ROGUE_VALIDATOR_KEY in .env for testnet mode.");

  const provider = new ethers.JsonRpcProvider(process.env.CHAIN_B_RPC || deployment.chainB.rpc);
  const abi = artifact("VeriMashGate").abi;
  const asAttacker = new ethers.Contract(deployment.chainB.gate, abi, new ethers.Wallet(attackerKey, provider));
  const asRogue = new ethers.Contract(deployment.chainB.gate, abi, new ethers.Wallet(rogueKey, provider));
  const results = [];
  const out = (...a) => print && console.log(...a);

  async function expectRevert(title, attack, fn, want) {
    try {
      await fn();
      results.push({ title, pass: false, detail: "NOT rejected" });
      out(`${G.red}✗ ${title}: attack was NOT rejected${G.r}`);
    } catch (e) {
      const why = reason(e);
      const pass = !want || why.includes(want);
      results.push({ title, pass, detail: why });
      out(`${pass ? G.g + "✓" : G.red + "✗"} ${G.b}${title}${G.r}\n   ${G.d}attack:${G.r} ${attack}\n   ${G.d}result:${G.r} ${pass ? "REJECTED" : "unexpected"} — ${why}`);
    }
  }

  out(`\n${G.b}VeriMash Security Lab${G.r}  ${G.d}gate ${deployment.chainB.gate} on ${deployment.chainB.name}${G.r}\n`);

  // 1. Outsider (a relayer, hacker, or our own server) tries to push a message
  await expectRevert(
    "Outsider cannot deliver",
    "a non-validator wallet calls attest() with a fake message",
    () => asAttacker.attest.staticCall(1n, asAttacker.runner.address, "Send 1000 tokens to attacker"),
    "not a validator"
  );

  // 2. One corrupt validator forges a message that never happened on Chain A
  const fakeNonce = BigInt(1_000_000_000 + Math.floor(Math.random() * 1e6));
  const fakeMsg = "FORGED: approve payout to attacker";
  const fakeSender = ethers.Wallet.createRandom().address;
  const key = await asRogue.messageKey(fakeNonce, fakeSender, fakeMsg);
  const tx = await asRogue.attest(fakeNonce, fakeSender, fakeMsg, await feeOverrides(provider));
  await tx.wait();
  const votes = await asRogue.votes(key);
  const delivered = await asRogue.isDelivered(fakeNonce);
  const pass2 = votes === 1n && !delivered;
  results.push({ title: "One corrupt validator cannot deliver", pass: pass2, detail: `${votes}/${deployment.threshold} votes, delivered=${delivered}` });
  out(`${pass2 ? G.g + "✓" : G.red + "✗"} ${G.b}One corrupt validator cannot deliver${G.r}\n   ${G.d}attack:${G.r} a real validator signs a message that never happened on Chain A\n   ${G.d}result:${G.r} vote recorded but stuck at ${votes}/${deployment.threshold} — NOT delivered. The honest validators never confirm it.`);

  // 3. Same validator tries to vote twice to fake a majority
  await expectRevert(
    "Double-voting blocked",
    "the corrupt validator votes again for its forged message",
    () => asRogue.attest.staticCall(fakeNonce, fakeSender, fakeMsg),
    "already attested"
  );

  const count = await asRogue.deliveryCount();
  if (count > 0n) {
    const d = await asRogue.getDelivery(0n);
    // 4. Tamper with a message that was already delivered
    await expectRevert(
      "Tampered content blocked",
      `change delivered message #${d.nonce} "${d.message}" by one character`,
      () => asRogue.attest.staticCall(d.nonce, d.sender, d.message + "!"),
      "conflicting message"
    );
    // 5. Replay a delivered message
    const voted = await asRogue.hasVoted(d.key, asRogue.runner.address);
    if (voted) {
      await expectRevert("Replay blocked", `re-submit delivered message #${d.nonce} again`, () => asRogue.attest.staticCall(d.nonce, d.sender, d.message), "already attested");
    } else {
      out(`${G.y}• Replay test skipped: this validator never voted on #${d.nonce}${G.r}`);
    }
  } else {
    out(`${G.y}• Tamper and replay tests need one delivered message first — send one, then run again.${G.r}`);
  }

  const passed = results.filter((r) => r.pass).length;
  out(`\n${passed === results.length ? G.g : G.red}${G.b}${passed}/${results.length} attacks rejected${G.r}\n`);
  provider.destroy();
  return results;
}

module.exports = { runAttacks };
if (require.main === module) runAttacks().catch((e) => { console.error(e.message); process.exit(1); });
