// Creates a fresh wallet for a validator (or the deployer).
//   npm run keygen
const { ethers } = require("ethers");
const w = ethers.Wallet.createRandom();
console.log(`
New wallet
  Address:     ${w.address}
  Private key: ${w.privateKey}

- Give ONLY the address to whoever deploys (it goes in VALIDATORS=...).
- Keep the private key on your own laptop, in your validator .env file. Never share it.
- Fund the address with a little test POL (Chain B gas) from a faucet.
`);
