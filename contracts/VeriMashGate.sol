// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VeriMashGate — lives on Blockchain B (e.g. Polygon Amoy)
/// @notice Accepts a message from Chain A only after `threshold` of the
///         independent validators have each attested to the exact same content.
///
///         There is NO relayer and NO admin:
///           - every validator submits its own vote from its own key, as its own transaction
///           - the contract counts the votes itself and delivers when the threshold is reached
///           - the validator set and threshold are fixed at deployment
///
///         A vote is bound to (source chain, source contract, destination chain,
///         this contract, nonce, sender, message hash). Change one byte and it is a
///         different message that needs its own threshold of votes.
contract VeriMashGate {
    uint256 public immutable sourceChainId;
    address public immutable sourceContract;
    uint256 public immutable threshold;

    address[] private _validators;
    mapping(address => bool) public isValidator;

    mapping(bytes32 => uint256) public votes;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    /// @dev nonce => key of the content that was delivered for it (0 = not delivered)
    mapping(uint64 => bytes32) public deliveredKeyForNonce;

    struct Delivery {
        uint64 nonce;
        address sender;
        string message;
        bytes32 key;
        uint64 deliveredAt;
    }
    Delivery[] private _deliveries;

    event Attested(bytes32 indexed key, uint64 indexed nonce, address indexed validator, uint256 votes);
    event MessageDelivered(bytes32 indexed key, uint64 indexed nonce, address indexed sender, string message, uint256 votes);

    constructor(uint256 _sourceChainId, address _sourceContract, address[] memory validators_, uint256 _threshold) {
        require(_sourceChainId != block.chainid, "Gate: source must be another chain");
        require(_sourceContract != address(0), "Gate: source contract required");
        require(_threshold > 0 && _threshold <= validators_.length, "Gate: bad threshold");
        require(_threshold * 2 > validators_.length, "Gate: threshold must be a majority");
        for (uint256 i = 0; i < validators_.length; i++) {
            address v = validators_[i];
            require(v != address(0), "Gate: zero validator");
            require(!isValidator[v], "Gate: duplicate validator");
            isValidator[v] = true;
            _validators.push(v);
        }
        sourceChainId = _sourceChainId;
        sourceContract = _sourceContract;
        threshold = _threshold;
    }

    function messageKey(uint64 nonce, address sender, string calldata message) public view returns (bytes32) {
        return keccak256(
            abi.encode(sourceChainId, sourceContract, block.chainid, address(this), nonce, sender, keccak256(bytes(message)))
        );
    }

    /// @notice Called by each validator, independently, after it has checked Chain A itself.
    function attest(uint64 nonce, address sender, string calldata message) external {
        require(isValidator[msg.sender], "Gate: not a validator");
        bytes32 key = messageKey(nonce, sender, message);

        bytes32 done = deliveredKeyForNonce[nonce];
        require(done == bytes32(0) || done == key, "Gate: conflicting message for delivered nonce");
        require(!hasVoted[key][msg.sender], "Gate: validator already attested");

        hasVoted[key][msg.sender] = true;
        uint256 v = ++votes[key];
        emit Attested(key, nonce, msg.sender, v);

        // Deliver exactly once, at the moment the threshold is reached.
        // Later votes (e.g. the 3rd validator) are still recorded, but never re-deliver.
        if (v == threshold) {
            deliveredKeyForNonce[nonce] = key;
            _deliveries.push(Delivery(nonce, sender, message, key, uint64(block.timestamp)));
            emit MessageDelivered(key, nonce, sender, message, v);
        }
    }

    function isDelivered(uint64 nonce) external view returns (bool) {
        return deliveredKeyForNonce[nonce] != bytes32(0);
    }

    function validators() external view returns (address[] memory) {
        return _validators;
    }

    function deliveryCount() external view returns (uint256) {
        return _deliveries.length;
    }

    function getDelivery(uint256 i) external view returns (Delivery memory) {
        return _deliveries[i];
    }
}
