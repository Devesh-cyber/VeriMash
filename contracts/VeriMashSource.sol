// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VeriMashSource — lives on Blockchain A (e.g. Ethereum Sepolia)
/// @notice Person 1 (the sender) calls sendMessage() from their own wallet and names
///         Person 2 (the recipient) by their wallet address on Chain B. That emits an
///         event which independent validators read from Chain A by themselves.
///         No server sends this transaction on the user's behalf.
contract VeriMashSource {
    uint64 public nonce;

    event MessageSent(
        uint64 indexed nonce,
        address indexed sender,
        uint256 indexed destChainId,
        address recipient,
        string message
    );

    function sendMessage(uint256 destChainId, address recipient, string calldata message) external returns (uint64 n) {
        uint256 len = bytes(message).length;
        require(len > 0 && len <= 280, "VeriMash: message must be 1-280 bytes");
        require(destChainId != block.chainid, "VeriMash: destination must be another chain");
        require(recipient != address(0), "VeriMash: recipient required");
        n = ++nonce;
        emit MessageSent(n, msg.sender, destChainId, recipient, message);
    }
}
