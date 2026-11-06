// Points the WEBSITE at your own RPC links (e.g. Alchemy) — no redeploy, contracts stay the same.
//
//   1. In .env add:
//        BROWSER_RPC_A=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
//        BROWSER_RPC_B=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
//   2. npm run set-rpc
//   3. Commit + push frontend/config.js (Vercel redeploys by itself)
//
// MetaMask keeps using the public RPCs (walletRpc), so your key is only used for reading.
const fs = require("fs");
const path = require("path");
const { ROOT, loadEnvFile } = require("../lib/common");
const { PRESETS } = require("./deploy");

loadEnvFile(path.join(ROOT, ".env"));
const file = path.join(ROOT, "frontend", "config.js");
if (!fs.existsSync(file)) { console.error("frontend/config.js not found. Deploy first."); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\s*window\.VERIMASH\s*=\s*/, "").replace(/;\s*$/, ""));
if (cfg.local) { console.error("This config is from `npm run local`. set-rpc is for testnet deployments."); process.exit(1); }

async function chainIdOf(url) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const j = await r.json();
  if (!j.result) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return parseInt(j.result, 16);
}

(async () => {
  let changed = 0;
  for (const [side, env] of [["chainA", "BROWSER_RPC_A"], ["chainB", "BROWSER_RPC_B"]]) {
    const url = (process.env[env] || "").trim();
    if (!url) { console.log(`- ${env} not set, ${cfg[side].name} stays on ${cfg[side].rpc}`); continue; }
    let id;
    try { id = await chainIdOf(url); } catch (e) { console.error(`✗ ${env} did not answer: ${e.message}`); process.exit(1); }
    if (id !== cfg[side].chainId) { console.error(`✗ ${env} is chain ${id}, but ${cfg[side].name} is ${cfg[side].chainId}. Wrong link?`); process.exit(1); }
    cfg[side].walletRpc = cfg[side].walletRpc || PRESETS[id]?.publicRpc || cfg[side].rpc;
    cfg[side].rpc = url;
    console.log(`✓ ${cfg[side].name} (${id}) → ${url.replace(/\/v2\/.+$/, "/v2/…")}`);
    changed++;
  }
  if (!changed) return;
  fs.writeFileSync(file, `window.VERIMASH = ${JSON.stringify(cfg, null, 2)};\n`);
  console.log("Wrote frontend/config.js. Commit + push it so Vercel picks it up.");
})();
