# CollectorDAO

A governance smart contract for a decentralized autonomous organization (DAO) aimed at buying NFTs. The contract implements the following:

1. Voting system with signature votes through usage of type structured data hashing ([EIP-712](https://eips.ethereum.org/EIPS/eip-712))
1. Proposal system, able to call arbitrary functions.
1. Automated purchases NFTs at a particular price.

[Audited by 0xMacro staff](./staff-audit-dao.md).

## Notes

### Testing

Run tests using the following command:

```
npx hardhat test
```

- `dao.test.ts` file is used for testing. Runtime of the test is very much proportional to the `VOTING_PERIOD` constant value in `CollectorDAO.sol`. I have this set to a low value of 50 blocks. However, for production, a much higher value of 3 days would be appropriate. This is commented out right above the declaration. I've left it at 50 so auditors can run the tests easily. See [Running Tests section](#running-tests) for reasoning.

### Intentional Design Choices

- `execute()` allows for identical subcommands to be executed. This is following advice given on [Compound Alph Governance Audit](https://forum.openzeppelin.com/t/compound-alpha-governance-system-audit/2376).
- Zero addresses are not allowed to be in the `targets` field of a proposals. This is because `address(0).call{...}()` runs and returns `true`. See [rekt article on Quibit Hack](https://rekt.news/qubit-rekt/).
- `execute()` returns an array of return values so that caller can know what's going on. This is following advice given in [Compound Alph Governance Audit](https://forum.openzeppelin.com/t/compound-alpha-governance-system-audit/2376).
- Hashing system is used similar to OZ's `Governor.sol` in which not all of the proposal data is stored on-chain.
- `signatures` parameter is not included (similar to `Governor.sol`) in many of the DAO functions like propose and execute. We are relying on users to store and calculate the correct abi encoded calldata to be passed in to the arbitrary call.
- I've imported OZ's `IERC721Received` contract to allow for SafeTransfers. This was ok'd by the staff in the discord.
- Some known tradeoffs
  - I believe there can be some gas optimizations that can happen in the `castVotesBySig()` function by amortizing the vote tallys, however I opted for the simple/clearer approach with a simple for-loop that calls the `castVoteBySig()` function. Enabling the optimization would require splitting up existing functions that are already in line with common governance DAO patterns.
  - `castVotesBySig()` contains a for loop that could iterate over a potentially large amount of values. To aid in this, the function includes a `uint from` and `uint to` parameters to specify the indices at which the function would iterate. This provides the ability to split the total votes in manageable chunks. I believe a griefing attack is unlikely because 1. signers have additional ways to cast votes: `castVote()` and `castVoteBySig()` , hence a vote cannot be blocked. And 2. execution is at the cost of the caller. A large parameter would proportionally cost more for the caller.
  - No nonce is used in the castVote functions because replay attacks are already protected by the `require(<ensure adddress is a member>)` checks in the following statements.

### Voting System

- Quorum is defined as the minimum number of `for` and `abstain` votes required for a vote to be valid. For this contract we have a 25% quorum. Hence, `for + abstain >= 25% of total population`.
- To prevent the sybil-like scenario in which a member is unhappy with an active proposal, and then goes about spinning up new members to defeat the proposal, this DAO does not allow new members to vote on anything until it a certain number of blocks specified by `VOTE_PERIOD`. This is the same amount of time any proposal is allowed to vote.
- For this DAO, the quorum number is defined at the time of the proposal. It uses the total member count at that instance and multiplies it by 25%. This is to accurately reflect the state of the DAO a the time of the proposal.
- In order for a proposal to pass, quorum must be met AND there must be more `for` votes than there are `against` votes.

### Running Tests

- Due to the `CollectorDAO` contract using block numbers as a form of time, the typescript tests make heavy use of `await network.provider.send("evm_mine")` calls to fastforward time. If I need to move forward N blocks, I am calling **evm_mine** N times. At the moment, I am unaware of a more efficient way to change the block number in testing.

- For production, `VOTING_PERIOD` should be set to a high number (3 days), which I believe would be a more realistic time frame for DAO members to vote. Unfortunately, a 3day value would make the tests run much more slowly.
