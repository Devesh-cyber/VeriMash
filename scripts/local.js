// One-command local demo: two independent chains, deploy, three validators, web app.
//
//   npm run local
//
// Runs entirely on one PC, for development and rehearsal. For the real demo use testnets
// (see README). Local chains mine a block every 2 seconds, so "confirmations" are real.
const { spawn } = require("child_process");
const path = require("path");
const { ROOT, sleep, ethers } = require("../lib/common");
const { deploy } = require("./deploy");
const { runValidator } = require("../validator/validator");
const { serve } = require("./serve");

// Hardhat's public development accounts. NEVER use these on a real network.
const MNEMONIC = "test test test test test test test test test test test junk";
const devKey = (i) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey;

function startChain(config, port) {
  const child = spawn(process.execPath, [require.resolve("hardhat/internal/cli/cli"), "--config", path.join(ROOT, "hardhat", config), "node", "--hostname", "0.0.0.0", "--port", String(port)], {
    cwd: path.join(ROOT, "hardhat"),
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[chain :${port}] ${d}`));
  return child;
}

async function waitForRpc(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Chain at ${url} did not start`);
}

async function startStack({ withServer = true, quietValidators = false, validators: which = [0, 1, 2] } = {}) {
  console.log("Starting Blockchain A (31337) on :8545 and Blockchain B (31338) on :8546...");
  const chains = [startChain("chainA.config.js", 8545), startChain("chainB.config.js", 8546)];
  await Promise.all([waitForRpc("http://127.0.0.1:8545"), waitForRpc("http://127.0.0.1:8546")]);

  const vKeys = [devKey(1), devKey(2), devKey(3)];
  const deployment = await deploy({
    rpcA: "http://127.0.0.1:8545",
    rpcB: "http://127.0.0.1:8546",
    deployerKey: devKey(0),
    validators: vKeys.map((k) => new ethers.Wallet(k).address),
    validatorNames: ["Validator 1", "Validator 2", "Validator 3"],
    threshold: 2,
    confirmations: 2,
    local: true,
    demoKey: devKey(4),
  });

  const running = {};
  const startValidator = async (i) => {
    running[i] = await runValidator({ key: vKeys[i], deployment, name: `Validator ${i + 1}`, pollMs: 1500, quiet: quietValidators });
    return running[i];
  };
  const stopValidator = (i) => { running[i]?.stop(); delete running[i]; };
  for (const i of which) await startValidator(i);

  const server = withServer ? serve(8080) : null;
  const stop = () => { Object.keys(running).forEach(stopValidator); server?.close(); chains.forEach((c) => c.kill()); };
  return { deployment, keys: { deployer: devKey(0), validators: vKeys, demo: devKey(4), attacker: devKey(5) }, startValidator, stopValidator, stop };
}

module.exports = { startStack, devKey };

if (require.main === module) {
  startStack().then(({ stop }) => {
    console.log("\nLocal stack running. Open the frontend, send a message, and watch the validators vote.");
    console.log("Tip: run `npm run attack` in another terminal for the Security Lab.  Ctrl+C to stop.\n");
    const bye = () => { stop(); process.exit(0); };
    process.on("SIGINT", bye); process.on("SIGTERM", bye);
  }).catch((e) => { console.error(e); process.exit(1); });
}
