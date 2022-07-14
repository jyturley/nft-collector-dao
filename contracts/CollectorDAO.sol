//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./NftMarketplace.sol";
import "./Membership.sol";

contract CollectorDAO is Membership, IERC721Receiver {
    uint256 public constant QUORUM_NUMERATOR = 25;
    uint256 public constant QUORUM_DENOMINATOR = 100;
    uint256 public constant PROPOSAL_MAX_OPERATIONS = 10;
    uint256 public constant VOTING_DELAY = 10; // in blocks

    // 17280 blocks * 15sec/block => 259200s => approximately 3days
    // uint256 public constant VOTING_PERIOD = 17280;
    uint256 public constant VOTING_PERIOD = 50; // Used for testing

    bytes32 private immutable domainHash;

    string public constant NAME = "Collector DAO";
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );
    bytes32 public constant BALLOT_TYPEHASH =
        keccak256("Ballot(uint256 proposalId,uint8 support)");

    struct Proposal {
        // The block at which voting begins
        uint256 startBlock;
        // The block at which voting ends
        uint256 endBlock;
        // Minimum value to meet quorum calculated at time of proposal
        uint256 quorum;
        bool executed;
    }
    mapping(uint256 => Proposal) public proposals;

    struct ProposalVote {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
        mapping(address => bool) hasVoted;
    }
    mapping(uint256 => ProposalVote) public proposalVotes;

    enum VoteType {
        Against,
        For,
        Abstain
    }

    enum ProposalState {
        Pending,
        Active,
        Defeated,
        Succeeded,
        Executed
    }

    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        uint256 startBlock,
        uint256 endBlock,
        uint256 quorum,
        string description
    );
    event ProposalExecuted(uint256 proposalId);
    event VoteCast(address indexed voter, uint256 proposalId, uint8 support);
    event NFTPurchased(
        address indexed nftContract,
        uint256 tokenId,
        uint256 price
    );

    /**
     * @notice Constructor that caches the domain hash
     */
    constructor() {
        domainHash = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                block.chainid,
                this
            )
        );
    }

    /**
     * @notice Propose an arbitrary sequence of commands for the DAO contract
     * to execute.
     * @param targets Array of addresses to be called
     * @param values Array of eth amounts to be used in the calls
     * @param calldatas Array of arguments to the call function. ABI encoded
     * function signature and parameters.
     * @param description Description of the proposal. This is also one of the identifiers
     * to generate a proposal hash identifier.
     * @dev Each index should map to one valid abstract call.
     * Hence, all input arrays should be of the same length.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external onlyMember(msg.sender) returns (uint256) {
        require(
            targets.length == values.length &&
                targets.length == calldatas.length,
            "Invalid proposal parameter lengths"
        );
        require(targets.length > 0, "Proposal must not be empty");
        require(targets.length <= PROPOSAL_MAX_OPERATIONS, "Too many actions");

        uint256 proposalId = hashProposal(
            targets,
            values,
            calldatas,
            keccak256(bytes(description))
        );

        Proposal storage proposal = proposals[proposalId];
        require(proposal.startBlock == 0, "Proposal has already been proposed");
        _checkForZeroTargets(targets);

        uint256 votingStart = block.number + VOTING_DELAY;
        uint256 votingEnd = votingStart + VOTING_PERIOD;
        proposal.startBlock = votingStart;
        proposal.endBlock = votingEnd;
        proposal.quorum =
            (currentMemberCount * QUORUM_NUMERATOR) /
            QUORUM_DENOMINATOR;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            targets,
            values,
            calldatas,
            votingStart,
            votingEnd,
            proposal.quorum,
            description
        );
        return proposalId;
    }

    /**
     * @notice Execute a proposal that has been voted for by the DAO
     * @param targets Array of addresses to be called
     * @param values Array of eth amounts to be used in the calls
     * @param calldatas Array of arguments to the call function. ABI encoded
     * function signature and parameters.
     * @param descriptionHash Description of the proposal. This is also one of the
     * identifiers required generate a proposal hash identifier.
     * @dev Each index should map to one valid abstract call.
     * Hence, all input arrays should be of the same length.
     */
    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) external payable onlyMember(msg.sender) returns (bytes[] memory) {
        uint256 proposalId = hashProposal(
            targets,
            values,
            calldatas,
            descriptionHash
        );
        require(
            getState(proposalId) == ProposalState.Succeeded,
            "Proposal must be successful to execute"
        );
        proposals[proposalId].executed = true;

        bytes[] memory actionResults = new bytes[](targets.length);
        for (uint256 i = 0; i < targets.length; ++i) {
            (bool success, bytes memory returndata) = targets[i].call{
                value: values[i]
            }(calldatas[i]);
            require(success, "Transaction execution reverted");
            actionResults[i] = returndata;
        }

        emit ProposalExecuted(proposalId);
        return actionResults;
    }

    /**
     * @notice Convenience function to purchase NFT at a given marketplace
     * @param marketAddress Address of contract that uses the INftMarketplace interface
     * @param nftContract Address of NFT contract to purchase
     * @param tokenId TokenId of particular NFT to purchase
     * @param maxPrice Max price DAO is willing to pay.
     * @dev Function can only be called by the execute() function.
     */
    function purchaseNFT(
        INftMarketplace marketAddress,
        address nftContract,
        uint256 tokenId,
        uint256 maxPrice
    ) external payable returns (bool) {
        require(msg.sender == address(this), "Must be called by contract");
        require(msg.value >= maxPrice, "More ETH required");
        uint256 nftPrice = INftMarketplace(marketAddress).getPrice(
            nftContract,
            tokenId
        );
        if (nftPrice > maxPrice) {
            return false;
        }

        bool success = INftMarketplace(marketAddress).buy{value: nftPrice}(
            nftContract,
            tokenId
        );

        if (!success) {
            return false;
        }

        emit NFTPurchased(nftContract, tokenId, nftPrice);
        return true;
    }

    /**
     * @notice Cast a single vote
     * @param proposalId proposal identifier.
     * @param support values of 0=against, 1=for, 2=abstain
     */
    function castVote(uint256 proposalId, uint8 support)
        external
        onlyMember(msg.sender)
        returns (bool success)
    {
        _castVote(proposalId, msg.sender, support);
        return true;
    }

    /**
     * @notice Cast multiple votes by signatures
     * @param support Array of support values of 0=against, 1=for, 2=abstain
     * @param v Array of ECDSA 'v' values
     * @param r Array of ECDSA 'r' values
     * @param s Array of ECDSA 's' values
     * @param from Index at which the loop should start.
     * @param to Index at which the loop should end. Must be <= support.length
     * @dev Each index should map to one valid signature.
     * Hence, all input arrays should be of the same length.
     */
    function castVotesBySig(
        uint256 proposalId,
        uint8[] calldata support,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 from,
        uint256 to
    ) external returns (bool) {
        require(
            getState(proposalId) == ProposalState.Active,
            "Proposal must be active for votes"
        );
        require(
            support.length == v.length &&
                v.length == r.length &&
                r.length == s.length,
            "Invalid signature parameter lengths"
        );
        require(from < support.length, "Invalid 'from' index given");
        require(to <= support.length, "Invalid 'to' index given");

        for (uint256 i = from; i < to; i++) {
            castVoteBySig(proposalId, support[i], v[i], r[i], s[i]);
        }

        return true;
    }

    /**
     * @notice Cast a single vote by signature
     * @param support support value where 0=against, 1=for, 2=abstain
     * @param v ECDSA 'v' value
     * @param r ECDSA 'r' value
     * @param s ECDSA 's' value
     */
    function castVoteBySig(
        uint256 proposalId,
        uint8 support,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public returns (bool success) {
        bytes32 structHash = getBallotHash(proposalId, support);
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainHash, structHash)
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "ECDSA: invalid signature");
        _castVote(proposalId, signer, support);
        return true;
    }

    /**
     * @notice Get state of a certain proposal
     * @param proposalId A proposal identifier
     */
    function getState(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.startBlock != 0, "Invalid proposal given");

        if (proposal.executed) {
            return ProposalState.Executed;
        }

        if (proposal.startBlock >= block.number) {
            return ProposalState.Pending;
        }

        if (proposal.endBlock >= block.number) {
            return ProposalState.Active;
        }

        if (
            _quorumReached(proposal.quorum, proposalId) &&
            _voteSucceeded(proposalId)
        ) {
            return ProposalState.Succeeded;
        }

        return ProposalState.Defeated;
    }

    /**
     * @notice Check if an account has voted for the proposal
     * @param proposalId Proposal Identifier
     * @param account Address to check
     */
    function hasVoted(uint256 proposalId, address account)
        external
        view
        returns (bool)
    {
        return proposalVotes[proposalId].hasVoted[account];
    }

    /**
     * @notice Generate a proposalId
     * @param targets Array of addresses to be called
     * @param values Array of eth amounts to be used in the calls
     * @param calldatas Array of arguments to the call function. ABI encoded
     * function signature and parameters.
     * @param descriptionHash  keccak256 hash of the proposal description.
     */
    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public pure returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(targets, values, calldatas, descriptionHash)
                )
            );
    }

    /**
     * @notice Check if an account has voted for the proposal
     * @param proposalId Proposal Identifier
     * @param support support value where 0=against, 1=for, 2=abstain
     */
    function getBallotHash(uint256 proposalId, uint8 support)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(BALLOT_TYPEHASH, proposalId, support));
    }

    /**
     * @notice Override to allow for contract to receive ERC721 transfers
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @notice Cast a single vote
     * @param proposalId proposal identifier.
     * @param account voting account
     * @param support values of 0=against, 1=for, 2=abstain
     */
    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support
    ) private {
        require(
            getState(proposalId) == ProposalState.Active,
            "Proposal must be active for a vote"
        );
        require(
            memberStartBlock[account] != 0 &&
                memberStartBlock[account] + VOTING_PERIOD <= block.number,
            "Not a member or account too new"
        );

        _countVote(proposalId, account, support);
        emit VoteCast(account, proposalId, support);
    }

    /**
     * @notice Count a vote
     * @param proposalId proposal identifier.
     * @param account voting account
     * @param support values of 0=against, 1=for, 2=abstain
     */
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support
    ) private {
        ProposalVote storage proposalvote = proposalVotes[proposalId];
        require(!proposalvote.hasVoted[account], "Account has already voted");
        proposalvote.hasVoted[account] = true;

        if (support == uint8(VoteType.Against)) {
            proposalvote.againstVotes += 1;
        } else if (support == uint8(VoteType.For)) {
            proposalvote.forVotes += 1;
        } else if (support == uint8(VoteType.Abstain)) {
            proposalvote.abstainVotes += 1;
        } else {
            revert("Invalid value used for voting");
        }
    }

    /**
     * @notice Check if quorum has been met.
     * @param quorum proposal quorum.
     * @param proposalId proposal identifier.
     */
    function _quorumReached(uint256 quorum, uint256 proposalId)
        private
        view
        returns (bool)
    {
        ProposalVote storage proposalvote = proposalVotes[proposalId];
        return quorum <= proposalvote.forVotes + proposalvote.abstainVotes;
    }

    /**
     * @notice Check if 'for' vote count is larger than 'against' vote count
     * @param proposalId proposal identifier.
     */
    function _voteSucceeded(uint256 proposalId) private view returns (bool) {
        ProposalVote storage proposalvote = proposalVotes[proposalId];
        return proposalvote.forVotes > proposalvote.againstVotes;
    }

    /**
     * @notice Ensure no proposal is submitted with a zero address as the target
     * @param targets Array of addresses to be called from
     */
    function _checkForZeroTargets(address[] memory targets) private pure {
        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] != address(0),
                "Target cannot be a zero address"
            );
        }
    }
}
