window.VERIMASH = {
  "createdAt": "2026-11-05T18:32:31.590Z",
  "local": false,
  "threshold": 2,
  "confirmations": 2,
  "chainA": {
    "chainId": 11155111,
    "name": "Ethereum Sepolia",
    "currency": "ETH",
    "explorer": "https://sepolia.etherscan.io",
    "publicRpc": "https://ethereum-sepolia-rpc.publicnode.com",
    "rpc": "https://ethereum-sepolia-rpc.publicnode.com",
    "source": "0xf2a14ddFa5c6b212D95DDd89E68cE365Dc0633b0",
    "deployBlock": 12071278
  },
  "chainB": {
    "chainId": 31338,
    "name": "Local Chain B",
    "currency": "ETH",
    "explorer": "",
    "publicRpc": "http://127.0.0.1:8546",
    "rpc": "http://127.0.0.1:8546",
    "gate": "0x29FbA6c546a0Cc426df153e3BA4FCB2151a53efD",
    "deployBlock": 3319
  },
  "validators": [
    {
      "address": "0xd48Cb31421E4bEA049248eB78D4182c018fb6F5A",
      "name": "Devesh's laptop"
    },
    {
      "address": "0xadeF8b3201e1d661e2C34CFfA1a70A23918457bB",
      "name": "Zeenat's laptop"
    },
    {
      "address": "0x45686f131a84Cc15D9e52cac51b39187c8428179",
      "name": "Shivam's laptop"
    }
  ],
  "abis": {
    "source": [
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "uint256",
            "name": "destChainId",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "message",
            "type": "string"
          }
        ],
        "name": "MessageSent",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "nonce",
        "outputs": [
          {
            "internalType": "uint64",
            "name": "",
            "type": "uint64"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "destChainId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "message",
            "type": "string"
          }
        ],
        "name": "sendMessage",
        "outputs": [
          {
            "internalType": "uint64",
            "name": "n",
            "type": "uint64"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    "gate": [
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "_sourceChainId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "_sourceContract",
            "type": "address"
          },
          {
            "internalType": "address[]",
            "name": "validators_",
            "type": "address[]"
          },
          {
            "internalType": "uint256",
            "name": "_threshold",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "bytes32",
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "validator",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "votes",
            "type": "uint256"
          }
        ],
        "name": "Attested",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "bytes32",
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "MessageAccepted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "bytes32",
            "name": "key",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "string",
            "name": "message",
            "type": "string"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "votes",
            "type": "uint256"
          }
        ],
        "name": "MessageDelivered",
        "type": "event"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          }
        ],
        "name": "accept",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "",
            "type": "uint64"
          }
        ],
        "name": "accepted",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "message",
            "type": "string"
          }
        ],
        "name": "attest",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "",
            "type": "uint64"
          }
        ],
        "name": "deliveredKeyForNonce",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "deliveryCount",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "i",
            "type": "uint256"
          }
        ],
        "name": "getDelivery",
        "outputs": [
          {
            "components": [
              {
                "internalType": "uint64",
                "name": "nonce",
                "type": "uint64"
              },
              {
                "internalType": "address",
                "name": "sender",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
              },
              {
                "internalType": "string",
                "name": "message",
                "type": "string"
              },
              {
                "internalType": "bytes32",
                "name": "key",
                "type": "bytes32"
              },
              {
                "internalType": "uint64",
                "name": "deliveredAt",
                "type": "uint64"
              }
            ],
            "internalType": "struct VeriMashGate.Delivery",
            "name": "",
            "type": "tuple"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "hasVoted",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          }
        ],
        "name": "isDelivered",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "isValidator",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "nonce",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "message",
            "type": "string"
          }
        ],
        "name": "messageKey",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint64",
            "name": "",
            "type": "uint64"
          }
        ],
        "name": "recipientOf",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "sourceChainId",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "sourceContract",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "threshold",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "validators",
        "outputs": [
          {
            "internalType": "address[]",
            "name": "",
            "type": "address[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "votes",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ]
  }
};
