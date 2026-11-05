// Local Blockchain B (chain ID 31338). A separate node with separate state.
module.exports = {
  paths: { sources: "./empty", cache: "./cache-b", artifacts: "./artifacts-b" },
  networks: { hardhat: { chainId: 31338, mining: { auto: false, interval: 2000 } } },
};
