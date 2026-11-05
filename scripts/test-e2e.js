// End-to-end test of the whole system on two local chains.
//   npm test
// Checks: delivery with 3 validators, stall with only 1 online, catch-up when a
// laptop comes back, and every Security Lab attack.
const { artifact, sleep, ethers } = require("../lib/common");
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
  const source = new ethers.Contract(deployment.chainA.source, artifact("VeriMashSource").abi, new ethers.Wallet(keys.demo, pA));
  const gate = new ethers.Contract(deployment.chainB.gate, artifact("VeriMashGate").abi, pB);

  async function send(text) {
    const r = await (await source.sendMessage(deployment.chainB.chainId, text)).wait();
    return source.interface.parseLog(r.logs[0]).args.nonce;
  }
  const key = (n, text) => gate.messageKey(n, source.runner.address, text);

  try {
    console.log("\n— All 3 validators online");
    const n1 = await send("Invoice INV-2048 confirmed");
    check(await waitFor(() => gate.isDelivered(n1), 30000), `message #${n1} delivered on Chain B`);
    const k1 = await key(n1, "Invoice INV-2048 confirmed");
    await waitFor(async () => (await gate.votes(k1)) === 3n, 15000);
    check((await gate.votes(k1)) === 3n, "all 3 validators attested (late vote recorded, delivered once)");
    check((await gate.deliveryCount()) === 1n, "delivered exactly once");

    console.log("\n— Two laptops switched off (only Validator 1 online)");
    stack.stopValidator(1); stack.stopValidator(2);
    const n2 = await send("Certificate CERT-77 issued");
    const k2 = await key(n2, "Certificate CERT-77 issued");
    await waitFor(async () => (await gate.votes(k2)) === 1n, 20000);
    await sleep(6000);
    check((await gate.votes(k2)) === 1n && !(await gate.isDelivered(n2)), `message #${n2} stuck at 1/2 votes — NOT delivered`);

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
