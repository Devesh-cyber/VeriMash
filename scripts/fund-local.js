// Gives addresses 100 free coins on a LOCAL Hardhat chain (only works on your laptop chain).
//   npm run fund -- 0xAddress1 0xAddress2 ...
// Optional: CHAIN_B_RPC=http://127.0.0.1:8546 (default)
const rpc = process.env.FUND_RPC || "http://127.0.0.1:8546";
const addrs = process.argv.slice(2);
if (!addrs.length) { console.log("Usage: npm run fund -- 0xAddress1 0xAddress2 ..."); process.exit(1); }
(async () => {
  for (const a of addrs) {
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hardhat_setBalance", params: [a, "0x56BC75E2D63100000"] }) }).then((x) => x.json()).catch((e) => ({ error: { message: e.message } }));
    console.log(r.result === true ? `✓ ${a} now has 100 coins on ${rpc}` : `✗ ${a}: ${r.error?.message || JSON.stringify(r)}`);
  }
})();
