https://github.com/0xMacro/student.jyturley/tree/c3a34db49a1c4db086c85f03ac26435ea024df0d/dao

Audited By: baran


# General Comments

Excelent test coverage, well written contracts. You seem to know your way around :)

Thanks for the detailed notes in ReadMe. Your decisions are well thought and based on views of respected authorities.

- I love how you handle the whale attack with a simple approach :love:
- Using storage vars in places like `_voteSucceeded` and `_quorumReached` saves bunch of gas :fire:

# Design Exercise

Awesome thinking! I would also consider what would happen if someone decides to undo a delegation? That would effect the whole chain of delegations.

# Issues

**[M-1]** Voting restriction for new accounts does not work as expected

CollectorDAO.sol L417: New accounts are restriced by a cooldown before being able to vote. 
`MemberStartBlock + VOTING_PERIOD` supposed to be expired for new accounts to cast a vote. This calculation looks wrong because it does not take `VOTING_DELAY` into account.
Also, since the quorum is recorded in proposal creation, this makes it easier to exploit.
Consider this scenerio:

    block.number: 100
    VOTING_PERIOD: 10
    VOTING_DELAY: 5
    currentMemberCount: 20
    1) Proposal Created at block 100 by the attacker
      - proposal.startBlock = 100+5 = 105; proposal.endBlock=105+10 = 115; proposal.quorum = 5;
    2) Attacker creates new members to dao in the same block after creating proposal.
    3) These new accounts have memberStartBlock=100 but they are not included in the quorum.
    4) `_castVote` checks if the ` memberStartBlock[account] + VOTING_PERIOD <= block.number` holds which is true for block numbers 110,111,112,113,114,115 and gives the attacker a window of 5 blocks to exploit the vote.

Consider increasing cooldown window for new accounts to something like `VOTING_PERIOD + VOTING_DELAY + SOME_THRESHOLD`


**[L-1]** Block time may change

Using blocks instead of timestamps makes voting times less predictable. Block times have changed in the past, and they're set to change for ETH 2.0. Timestamps are only vulnerable to attacks when the window of time is short. Since this contract deals with days and weeks, there shouldn't be an issue with using timestamps

**[Technical Mistake]** Proposals should be atomic

DAO proposals is supposed to be atomic. `purchaseNFT` is not reverting with errors and this is causing failed transactions to look like successfull and execution continues with the next transaction. 
If the proposal is to buy 3 NFTs and one NFTs price increases in the meantime and it becomes more than the max price, the proposal should be reverted as buying 2 NFTs is not what is originally accepted by the DAO.


**[Q-1]** `purchaseNFT` expects a msg.value

Since this function is only will be called by the contract itself there is no need to pass a msg.value. It has access to the contract balance.

# Nitpicks

- Membership.sol L26: There is no need to check for 0 address as it is not owned by anyone, the sender never will be address(0)
- Instead of keeping two different mappings for `proposals` and `proposalVotes` with the same `proposalId`, I would go with single mapping with combination of both.

# Score

| Reason | Score |
|-|-|
| Late                       | - |
| Unfinished features        | - |
| Extra features             | - |
| Vulnerability              | 3 |
| Unanswered design exercise | - |
| Insufficient tests         | - |
| Technical mistake          | 1 |

Total: 4

Good job!
