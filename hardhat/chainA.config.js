// Local Blockchain A (chain ID 31337). Only used for `npm run local`.
module.exports = {
  paths: { sources: "./empty", cache: "./cache-a", artifacts: "./artifacts-a" },
  networks: { hardhat: { chainId: 31337, mining: { auto: false, interval: 2000 } } },
};
