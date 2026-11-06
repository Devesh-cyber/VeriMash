// Deploys VeriMashSource on Chain A and VeriMashGate on Chain B.
// Writes deployment.json (for validators) and frontend/config.js (for the web app).
//
// Usage (testnet):  npm run deploy:testnet      (reads .env)
// Used internally by: npm run local
const fs = require("fs");
const path = require("path");
const { ROOT, artifact, loadEnvFile, feeOverrides, ethers } = require("../lib/common");

const PRESETS = {
  11155111: { name: "Ethereum Sepolia", currency: "ETH", explorer: "https://sepolia.etherscan.io", publicRpc: "https://ethereum-sepolia-rpc.publicnode.com" },
  80002: { name: "Polygon Amoy", currency: "POL", explorer: "https://amoy.polygonscan.com", publicRpc: "https://rpc-amoy.polygon.technology" },
  43113: { name: "Avalanche Fuji", currency: "AVAX", explorer: "https://testnet.snowtrace.io", publicRpc: "https://api.avax-test.network/ext/bc/C/rpc" },
  84532: { name: "Base Sepolia", currency: "ETH", explorer: "https://sepolia.basescan.org", publicRpc: "https://sepolia.base.org" },
  31337: { name: "Local Chain A", currency: "ETH", explorer: "", publicRpc: "http://127.0.0.1:8545" },
  31338: { name: "Local Chain B", currency: "ETH", explorer: "", publicRpc: "http://127.0.0.1:8546" },
};

async function deploy(opts) {
  const {
    rpcA, rpcB, deployerKey, validators, validatorNames = [], threshold = 2,
    confirmations = 2, local = false, browserRpcA, browserRpcB, demoKey, demoRecipientKey,
  } = opts;

  const provA = new ethers.JsonRpcProvider(rpcA);
  const provB = new ethers.JsonRpcProvider(rpcB);
  const [netA, netB] = await Promise.all([provA.getNetwork(), provB.getNetwork()]);
  const chainA = Number(netA.chainId), chainB = Number(netB.chainId);
  if (chainA === chainB) throw new Error(`Chain A and Chain B have the same chain ID (${chainA}). They must be different blockchains.`);

  const walletA = new ethers.Wallet(deployerKey, provA);
  const walletB = new ethers.Wallet(deployerKey, provB);
  console.log(`Deployer ${walletA.address}`);
  console.log(`Chain A ${chainA} balance: ${ethers.formatEther(await provA.getBalance(walletA.address))}`);
  console.log(`Chain B ${chainB} balance: ${ethers.formatEther(await provB.getBalance(walletB.address))}`);

  const S = artifact("VeriMashSource");
  const G = artifact("VeriMashGate");

  console.log("Deploying VeriMashSource on Chain A...");
  const source = await new ethers.ContractFactory(S.abi, S.bytecode, walletA).deploy(await feeOverrides(provA));
  const srcReceipt = await source.deploymentTransaction().wait();
  const sourceAddress = await source.getAddress();
  console.log(`  ${sourceAddress} (block ${srcReceipt.blockNumber})`);

  console.log(`Deploying VeriMashGate on Chain B (${validators.length} validators, threshold ${threshold})...`);
  const gate = await new ethers.ContractFactory(G.abi, G.bytecode, walletB).deploy(
    chainA, sourceAddress, validators, threshold, await feeOverrides(provB)
  );
  const gateReceipt = await gate.deploymentTransaction().wait();
  const gateAddress = await gate.getAddress();
  console.log(`  ${gateAddress} (block ${gateReceipt.blockNumber})`);

  const meta = (id, rpc) => ({ chainId: id, ...(PRESETS[id] || { name: `Chain ${id}`, currency: "ETH", explorer: "" }), rpc, walletRpc: PRESETS[id]?.publicRpc || rpc });
  const deployment = {
    createdAt: new Date().toISOString(),
    local,
    threshold,
    confirmations,
    chainA: { ...meta(chainA, browserRpcA || PRESETS[chainA]?.publicRpc || rpcA), source: sourceAddress, deployBlock: srcReceipt.blockNumber },
    chainB: { ...meta(chainB, browserRpcB || PRESETS[chainB]?.publicRpc || rpcB), gate: gateAddress, deployBlock: gateReceipt.blockNumber },
    validators: validators.map((address, i) => ({ address, name: validatorNames[i] || `Validator ${i + 1}` })),
  };

  fs.writeFileSync(path.join(ROOT, "deployment.json"), JSON.stringify(deployment, null, 2));
  const frontendCfg = { ...deployment, demoKey: local ? demoKey : undefined, demoRecipientKey: local ? demoRecipientKey : undefined, abis: { source: S.abi, gate: G.abi } };
  fs.writeFileSync(path.join(ROOT, "frontend", "config.js"), `window.VERIMASH = ${JSON.stringify(frontendCfg, null, 2)};\n`);
  console.log("Wrote deployment.json and frontend/config.js");
  return deployment;
}

module.exports = { deploy, PRESETS };

if (require.main === module) {
  loadEnvFile(path.join(ROOT, ".env"));
  const need = (k) => { if (!process.env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); } return process.env[k]; };
  const validators = need("VALIDATORS").split(",").map((s) => s.trim()).filter(Boolean);
  for (const v of validators) if (!ethers.isAddress(v)) { console.error(`Not an address: ${v}`); process.exit(1); }
  deploy({
    rpcA: need("CHAIN_A_RPC"),
    rpcB: need("CHAIN_B_RPC"),
    deployerKey: need("DEPLOYER_KEY"),
    validators,
    validatorNames: (process.env.VALIDATOR_NAMES || "").split(",").map((s) => s.trim()),
    threshold: Number(process.env.THRESHOLD || 2),
    confirmations: Number(process.env.CONFIRMATIONS || 2),
    browserRpcA: process.env.BROWSER_RPC_A,
    browserRpcB: process.env.BROWSER_RPC_B,
  }).catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
}
