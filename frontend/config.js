window.VERIMASH = {
  "createdAt": "2026-11-06T06:22:47.125Z",
  "local": true,
  "threshold": 2,
  "confirmations": 2,
  "chainA": {
    "chainId": 31337,
    "name": "Local Chain A",
    "currency": "ETH",
    "explorer": "",
    "publicRpc": "http://127.0.0.1:8545",
    "rpc": "http://127.0.0.1:8545",
    "walletRpc": "http://127.0.0.1:8545",
    "source": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "deployBlock": 1
  },
  "chainB": {
    "chainId": 31338,
    "name": "Local Chain B",
    "currency": "ETH",
    "explorer": "",
    "publicRpc": "http://127.0.0.1:8546",
    "rpc": "http://127.0.0.1:8546",
    "walletRpc": "http://127.0.0.1:8546",
    "gate": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "deployBlock": 3
  },
  "validators": [
    {
      "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "name": "Validator 1"
    },
    {
      "address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "name": "Validator 2"
    },
    {
      "address": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      "name": "Validator 3"
    }
  ],
  "demoKey": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "demoRecipientKey": "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
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
