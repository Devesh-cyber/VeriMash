// End-to-end test of the whole system on two local chains.
//   npm test
// Two people: Person 1 sends on Chain A, Person 2 accepts on Chain B.
// Checks: delivery with 3 validators, stall with only 1 online, catch-up when a
// laptop comes back, receiver-only acceptance, and every Security Lab attack.
const { artifact, sleep, reason, ethers } = require("../lib/common");
const { startStack } = require("./local");
const { runAttacks } = require("./attack");

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${msg}\x1b[0m`); if (!ok) failures++; };

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(500); }
  return false;
}

(async () => {
  const stack = await startStack({ withServer: false, quietValidators: true });
  const { deployment, keys } = stack;
  const pA = new ethers.JsonRpcProvider(deployment.chainA.rpc);
  const pB = new ethers.JsonRpcProvider(deployment.chainB.rpc);
  const sender = new ethers.Wallet(keys.demo, pA);           // Person 1, on Chain A
  const recipient = new ethers.Wallet(keys.recipient, pB);   // Person 2, on Chain B
  const stranger = new ethers.Wallet(keys.attacker, pB);
  const GABI = artifact("VeriMashGate").abi;
  const source = new ethers.Contract(deployment.chainA.source, artifact("VeriMashSource").abi, sender);
  const gate = new ethers.Contract(deployment.chainB.gate, GABI, pB);
  const gateAsRecipient = gate.connect(recipient), gateAsStranger = gate.connect(stranger);

  async function send(text) {
    const r = await (await source.sendMessage(deployment.chainB.chainId, recipient.address, text)).wait();
    return source.interface.parseLog(r.logs[0]).args.nonce;
  }
  const key = (n, text) => gate.messageKey(n, sender.address, recipient.address, text);

  try {
    console.log(`\n— Person 1 ${sender.address.slice(0, 10)}… (Chain A) → Person 2 ${recipient.address.slice(0, 10)}… (Chain B), all 3 validators online`);
    const n1 = await send("Invoice INV-2048 confirmed");
    check(await waitFor(() => gate.isDelivered(n1), 30000), `message #${n1} delivered on Chain B`);
    const k1 = await key(n1, "Invoice INV-2048 confirmed");
    await waitFor(async () => (await gate.votes(k1)) === 3n, 15000);
    check((await gate.votes(k1)) === 3n, "all 3 validators attested (late vote recorded, delivered once)");
    check((await gate.deliveryCount()) === 1n, "delivered exactly once");
    check((await gate.recipientOf(n1)) === recipient.address, "gate records Person 2 as the recipient");

    console.log("\n— Person 2 accepts on Chain B with their own wallet");
    let why = null; try { await gateAsStranger.accept.staticCall(n1); } catch (e) { why = reason(e); }
    check(/only the recipient/.test(why || ""), `a stranger cannot accept (${why})`);
    await (await gateAsRecipient.accept(n1)).wait();
    check(await gate.accepted(n1), "Person 2 accepted the message");
    why = null; try { await gateAsRecipient.accept.staticCall(n1); } catch (e) { why = reason(e); }
    check(/already accepted/.test(why || ""), `cannot accept twice (${why})`);

    console.log("\n— Two laptops switched off (only Validator 1 online)");
    stack.stopValidator(1); stack.stopValidator(2);
    const n2 = await send("Certificate CERT-77 issued");
    const k2 = await key(n2, "Certificate CERT-77 issued");
    await waitFor(async () => (await gate.votes(k2)) === 1n, 20000);
    await sleep(6000);
    check((await gate.votes(k2)) === 1n && !(await gate.isDelivered(n2)), `message #${n2} stuck at 1/2 votes — NOT delivered`);
    why = null; try { await gateAsRecipient.accept.staticCall(n2); } catch (e) { why = reason(e); }
    check(/not delivered/.test(why || ""), `Person 2 cannot accept an undelivered message (${why})`);

    console.log("\n— Validator 2 laptop comes back");
    await stack.startValidator(1);
    check(await waitFor(() => gate.isDelivered(n2), 30000), `message #${n2} delivered after Validator 2 caught up`);

    console.log("\n— Security Lab");
    const results = await runAttacks({ deployment, print: false });
    for (const r of results) check(r.pass, `${r.title} (${r.detail})`);
  } catch (e) {
    check(false, `test crashed: ${e.stack || e.message}`);
  } finally {
    pA.destroy(); pB.destroy();
    stack.stop();
    console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m` : "\n\x1b[32mAll checks passed\x1b[0m");
    setTimeout(() => process.exit(failures ? 1 : 0), 500);
  }
})();
