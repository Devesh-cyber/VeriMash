// Compiles contracts/*.sol with the bundled solc (no internet download needed).
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "contracts");
const outDir = path.join(root, "artifacts");

const sources = {};
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".sol"))) {
  sources[f] = { content: fs.readFileSync(path.join(srcDir, f), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // safe on every testnet
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
for (const e of out.errors || []) console.log(e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync(outDir, { recursive: true });
for (const file of Object.keys(out.contracts)) {
  for (const [name, c] of Object.entries(out.contracts[file])) {
    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify({ contractName: name, abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
    );
    console.log(`compiled ${name}`);
  }
}
