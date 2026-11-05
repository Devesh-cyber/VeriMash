// Shared helpers for deploy, validator, attack and test scripts.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");

function artifact(name) {
  const p = path.join(ROOT, "artifacts", `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Run: npm run compile`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadDeployment(file) {
  const p = path.resolve(file || process.env.DEPLOYMENT || path.join(ROOT, "deployment.json"));
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}. Deploy first (npm run local, or npm run deploy:testnet).`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Load a simple KEY=VALUE env file into process.env (without overriding real env vars).
function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

// Polygon Amoy rejects transactions whose priority fee is below ~25 gwei,
// and ethers' default is lower, so we set fees explicitly there.
async function feeOverrides(provider) {
  const { chainId } = await provider.getNetwork();
  if (chainId === 80002n || chainId === 137n) {
    const block = await provider.getBlock("latest");
    const base = block?.baseFeePerGas ?? ethers.parseUnits("30", "gwei");
    const tip = ethers.parseUnits("30", "gwei");
    return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
  }
  return {};
}

// Turn an ethers error into the human revert reason, e.g. "Gate: not a validator".
function reason(err) {
  return (
    err?.reason ||
    err?.revert?.args?.[0] ||
    err?.info?.error?.message ||
    err?.shortMessage ||
    err?.message ||
    String(err)
  ).replace(/^execution reverted:?\s*/i, "").replace(/^Error: VM Exception while processing transaction: reverted with reason string '(.*)'$/, "$1");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { ROOT, artifact, loadDeployment, loadEnvFile, feeOverrides, reason, sleep, ethers };
