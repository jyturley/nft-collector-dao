import chai, { expect } from "chai";
import { ethers, network, waffle } from "hardhat";
import { BigNumber, providers } from "ethers";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  CollectorDAO,
  CollectorDAO__factory,
  OpenOcean,
  OpenOcean__factory,
} from "../typechain-types";
import { AbiCoder, isAddress } from "ethers/lib/utils";
import { doesNotReject, ok } from "assert";
import { experimentalAddHardhatNetworkMessageTraceHook } from "hardhat/config";
import { exitCode } from "process";
import { Provider } from "@ethersproject/abstract-provider";

chai.use(waffle.solidity);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_ETHER: BigNumber = ethers.utils.parseEther("1");

const PROPOSAL_PENDING = 0;
const PROPOSAL_ACTIVE = 1;
const PROPOSAL_DEFEATED = 2;
const PROPOSAL_SUCCEEDED = 3;
const PROPOSAL_QUEUED = 3;
const PROPOSAL_EXECUTED = 4;
const VOTE_AGAINST = BigNumber.from("0");
const VOTE_FOR = BigNumber.from("1");
const VOTE_ABSTAIN = BigNumber.from("2");

const timeTravel = async (seconds: number) => {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
};

const setBlockTimeTo = async (seconds: number) => {
  await network.provider.send("evm_setNextBlockTimestamp", [seconds]);
  await network.provider.send("evm_mine");
};

const mineBlock = async (): Promise<void> => {
  await network.provider.send("evm_mine");
};

const advanceBlocks = async (blocks: number): Promise<void> => {
  for (let i = 0; i < blocks; i++) {
    await mineBlock();
  }
};

const ETH = (strETHAmt: string) => {
  return ethers.utils.parseEther(strETHAmt);
};

const encodeParameters = (types: string[], values: unknown[]): string => {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
};

describe("CollectorDAO Contract", function () {
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let chris: SignerWithAddress;
  let david: SignerWithAddress;
  let proposer: SignerWithAddress;

  let CollectorDAO: CollectorDAO__factory;
  let dao: CollectorDAO;
  let OpenOcean: OpenOcean__factory;
  let nft: OpenOcean;
  let VOTING_DELAY: number;
  let VOTING_PERIOD: number;
  let targets: string[];
  let values: string[];
  let callDatas: string[];
  let proposalDescription: string;
  let hash: string;
  let proposalId: BigNumber;
  let investors: SignerWithAddress[];

  const coolcatAddress = "0x1a92f7381b9f03921564a437210bb9396471050c";

  const passProposalWith = async (pid: BigNumber, vote: BigNumber) => {
    await advanceBlocks(VOTING_DELAY + 1);
    await dao.connect(proposer).castVote(pid, vote);
    await dao.connect(alice).castVote(pid, vote);
    await dao.connect(bob).castVote(pid, vote);
    await dao.connect(chris).castVote(pid, vote);
    await dao.connect(david).castVote(pid, vote);
    await advanceBlocks(VOTING_PERIOD + 1);
  };

  beforeEach(async () => {
    [deployer, alice, bob, chris, david, proposer, ...investors] = await ethers.getSigners();

    CollectorDAO = await ethers.getContractFactory("CollectorDAO");
    dao = (await CollectorDAO.deploy()) as CollectorDAO;
    await dao.deployed();

    OpenOcean = await ethers.getContractFactory("OpenOcean");
    nft = (await OpenOcean.deploy()) as OpenOcean;
    await nft.deployed();

    VOTING_DELAY = (await dao.VOTING_DELAY()).toNumber();
    VOTING_PERIOD = (await dao.VOTING_PERIOD()).toNumber();

    targets = [dao.address];
    values = ["0"];
    let ABI = ["function currentMemberCount()"];
    let iface = new ethers.utils.Interface(ABI);
    callDatas = [iface.encodeFunctionData("currentMemberCount")];
    proposalDescription = "check address balance";
    hash = ethers.utils.id(proposalDescription);
  });

  it("Deploys a Contract", async () => {
    expect(dao.address).to.be.ok;
  });
  it("DAO contract should have a balance", async () => {
    await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
    expect(await dao.provider.getBalance(dao.address)).to.equal(ONE_ETHER);
  });
  it("Unable to send eth directly to contract", async () => {
    await expect(
      alice.sendTransaction({
        to: dao.address,
        value: ONE_ETHER,
      })
    ).to.be.revertedWith(
      "Transaction reverted: function selector was not recognized and there's no fallback nor receive function"
    );
  });
  describe("Membership", () => {
    it("No one is automatically a member", async () => {
      expect(await dao.memberStartBlock(dao.address)).to.equal(0);
      expect(await dao.memberStartBlock(alice.address)).to.equal(0);
      expect(await dao.memberStartBlock(bob.address)).to.equal(0);
    });
    it("Anyone can buy membership for 1eth", async () => {
      const numMembersBefore = await dao.currentMemberCount();
      expect(await dao.connect(alice).buyMembership({ value: ONE_ETHER })).to.be.ok;
      const after = await dao.currentMemberCount();
      expect(after).to.equal(numMembersBefore.add(1));
      expect(await dao.provider.getBalance(dao.address)).to.equal(ONE_ETHER);
      expect(await dao.memberStartBlock(alice.address)).to.be.gt(0);
      expect(await dao.memberStartBlock(bob.address)).to.equal(0);
    });
    it("Disallows membership if < 1eth", async () => {
      await expect(
        dao.connect(alice).buyMembership({ value: ethers.utils.parseEther("0.5") })
      ).to.be.revertedWith("Cost of membership is 1 ETH");
    });
    it("Disallows membership if > 1eth", async () => {
      await expect(
        dao.connect(alice).buyMembership({ value: ethers.utils.parseEther("1.5") })
      ).to.be.revertedWith("Cost of membership is 1 ETH");
    });
    it("Disallows membership if already a member", async () => {
      await dao.connect(alice).buyMembership({ value: ONE_ETHER });
      await expect(dao.connect(alice).buyMembership({ value: ONE_ETHER })).to.be.revertedWith(
        "Address is already a member"
      );
    });
    it("Emits event if member is added", async () => {
      await expect(dao.connect(alice).buyMembership({ value: ONE_ETHER }))
        .to.emit(dao, "NewMemberAdded")
        .withArgs(alice.address, 1);
    });
  });
  describe("Proposals", () => {
    beforeEach(async () => {
      await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
      await dao.connect(alice).buyMembership({ value: ONE_ETHER });
      await dao.connect(bob).buyMembership({ value: ONE_ETHER });
      await dao.connect(chris).buyMembership({ value: ONE_ETHER });
      await dao.connect(david).buyMembership({ value: ONE_ETHER });
      proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
    });
    it("Members are able to make a proposal", async () => {
      expect(await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription))
        .to.be.ok;
      const currentBlock = await ethers.provider.getBlockNumber();
      const proposal = await dao.proposals(proposalId);
      expect(proposal.executed).to.be.false;
      expect(proposal.startBlock).to.equal(currentBlock + VOTING_DELAY);
      expect(proposal.endBlock).to.equal(currentBlock + VOTING_DELAY + VOTING_PERIOD);
    });
    it("Prevents non-members from making a proposal", async () => {
      await expect(
        dao.connect(investors[0]).propose(targets, values, callDatas, proposalDescription)
      ).to.revertedWith("Must be a member");
    });
    it("Prevents parameter length mismatch", async () => {
      values = [];
      await expect(
        dao.connect(alice).propose(targets, values, callDatas, proposalDescription)
      ).to.revertedWith("Invalid proposal parameter lengths");
    });
    it("Prevents empty parameters", async () => {
      targets = [];
      values = [];
      callDatas = [];
      await expect(
        dao.connect(alice).propose(targets, values, callDatas, proposalDescription)
      ).to.revertedWith("Proposal must not be empty");
    });
    it("Prevents too many operations proposed", async () => {
      for (let i = 0; i < 10; i++) {
        targets.push(dao.address);
        values.push("0");
        callDatas.push(encodeParameters(["address"], [proposer.address]));
      }
      await expect(
        dao.connect(alice).propose(targets, values, callDatas, proposalDescription)
      ).to.revertedWith("Too many actions");
    });
    it("Prevents same proposal being submitted", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await expect(
        dao.connect(proposer).propose(targets, values, callDatas, proposalDescription)
      ).to.be.revertedWith("Proposal has already been proposed");
    });
    it("Prevents proposal with zero address as the account", async () => {
      targets = [ZERO_ADDRESS];
      await expect(
        dao.connect(alice).propose(targets, values, callDatas, proposalDescription)
      ).to.revertedWith("Target cannot be a zero address");
    });
    it("Proposal event emitted", async () => {
      const currentBlock = await ethers.provider.getBlockNumber();
      await expect(dao.connect(proposer).propose(targets, values, callDatas, proposalDescription))
        .to.emit(dao, "ProposalCreated")
        .withArgs(
          proposalId,
          proposer.address,
          targets,
          values,
          callDatas,
          currentBlock + 1 + VOTING_DELAY,
          currentBlock + 1 + VOTING_DELAY + VOTING_PERIOD,
          1,
          proposalDescription
        );
    });
    it("Successful proposal puts it in a Pending state", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_PENDING);
    });
    it("Proposals ready to be voted is in a Active state", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await advanceBlocks(VOTING_DELAY + 1);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_ACTIVE);
    });
    it("Proposals past the deadline are in a defeated state", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await advanceBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
    });
    it("Finished proposals are in an executed state", async () => {
      await advanceBlocks(VOTING_PERIOD);
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await passProposalWith(proposalId, VOTE_FOR);
      await dao.connect(proposer).execute(targets, values, callDatas, hash);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_EXECUTED);
    });
  });
  describe("Voting", () => {
    beforeEach(async () => {
      await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
      await dao.connect(alice).buyMembership({ value: ONE_ETHER });
      await dao.connect(bob).buyMembership({ value: ONE_ETHER });
      await dao.connect(chris).buyMembership({ value: ONE_ETHER });
      await dao.connect(david).buyMembership({ value: ONE_ETHER });
      await advanceBlocks(VOTING_PERIOD + 1);
      proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
    });
    describe("Last Minute Voting", () => {
      beforeEach(async () => {
        // await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
        // await dao.connect(alice).buyMembership({ value: ONE_ETHER });
        // await dao.connect(bob).buyMembership({ value: ONE_ETHER });
        // proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
        // await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      });
      it("New members are not able to vote on existing proposals", async () => {
        for (let i = 0; i < 10; i++) {
          await dao.connect(investors[i]).buyMembership({ value: ONE_ETHER });
        }
        await expect(dao.connect(investors[0]).castVote(proposalId, VOTE_FOR)).to.be.revertedWith(
          "Not a member or account too new"
        );
        await expect(dao.connect(alice).castVote(proposalId, VOTE_FOR)).to.be.ok;
      });
    });
    describe("Quorum & Vote Counting", () => {
      beforeEach(async () => {
        proposalDescription = "rocketpool";
        hash = ethers.utils.id(proposalDescription);
        proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
        for (let i = 0; i < 15; i++) {
          await dao.connect(investors[i]).buyMembership({ value: ONE_ETHER });
        }
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.currentMemberCount()).to.be.equal(20);
        await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
        await advanceBlocks(VOTING_DELAY + 1);
      });
      it("Succeed if 25% quorum is met & more yes than no", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_FOR);
        expect(await dao.hasVoted(proposalId, investors[0].address)).to.be.true;
        expect(await dao.hasVoted(proposalId, investors[1].address)).to.be.true;
        expect(await dao.hasVoted(proposalId, investors[2].address)).to.be.true;
        expect(await dao.hasVoted(proposalId, investors[3].address)).to.be.true;
        expect(await dao.hasVoted(proposalId, investors[4].address)).to.be.true;
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      });
      it("Succeed if 25% quorum is met & most abstain but more yes than no", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[5]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[6]).castVote(proposalId, VOTE_FOR);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      });
      it("Fail if 25% quorum is met & equal no and yes", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_FOR);

        await dao.connect(investors[5]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[6]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[7]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[8]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[9]).castVote(proposalId, VOTE_AGAINST);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
      it("Fail if 25% quorum is met & more no than yes", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_AGAINST);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
      it("Fail if 25% quorum is met & everyone abstains", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_ABSTAIN);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
      it("Fail if 25% quorum is not met & more yes than no", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_FOR);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[4]).castVote(proposalId, VOTE_ABSTAIN);
        await advanceBlocks(VOTING_PERIOD + 1);
        const prop = await dao.proposals(proposalId);
        expect(prop.quorum).to.equal(5);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
      it("Fail if 25% quorum is not met & more no than yes", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_AGAINST);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_FOR);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
      it("Fail if 25% quorum is not met & everyone abstains", async () => {
        await dao.connect(investors[0]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[1]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[2]).castVote(proposalId, VOTE_ABSTAIN);
        await dao.connect(investors[3]).castVote(proposalId, VOTE_ABSTAIN);
        await advanceBlocks(VOTING_PERIOD + 1);
        expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      });
    });
    describe("Signatures", () => {
      const Domain = (gov: CollectorDAO) => ({
        name: "Collector DAO",
        chainId: 31337,
        verifyingContract: gov.address,
      });
      const Types = {
        Ballot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "uint8" },
        ],
      };
      const typedData = {
        EIP721Domain: [
          { name: "name", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      };
      let beforeVote: BigNumber;
      beforeEach(async () => {
        beforeVote = (await dao.proposalVotes(proposalId)).forVotes;
      });
      it("test verify without solidity", async () => {
        const ballot = {
          proposalId: 1234,
          support: 0,
        };
        const signature = await alice._signTypedData(Domain(dao), Types, ballot);

        // verify
        const expectedSignerAddress = alice.address;
        const recoveredAddress = ethers.utils.verifyTypedData(
          Domain(dao),
          Types,
          ballot,
          signature
        );
        expect(recoveredAddress).to.equal(expectedSignerAddress);
      });
      it("Members are able to vote with a signature", async () => {
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
        await advanceBlocks(VOTING_DELAY + 1);
        const ballot = {
          proposalId: proposalId,
          support: VOTE_FOR,
        };
        const signature = await alice._signTypedData(Domain(dao), Types, ballot);
        const { v, r, s } = ethers.utils.splitSignature(signature);
        expect(await dao.connect(alice).castVoteBySig(proposalId, VOTE_FOR, v, r, s)).to.be.ok;
        const afterVote = (await dao.proposalVotes(proposalId)).forVotes;
        expect(afterVote).to.be.equal(beforeVote.add(1));
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.true;
      });
      it("Members are able to submit someone elses valid vote via sig", async () => {
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
        expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
        await advanceBlocks(VOTING_DELAY + 1);
        const ballot = {
          proposalId: proposalId,
          support: VOTE_FOR,
        };
        const signature = await alice._signTypedData(Domain(dao), Types, ballot);
        const { v, r, s } = ethers.utils.splitSignature(signature);
        expect(await dao.connect(bob).castVoteBySig(proposalId, VOTE_FOR, v, r, s)).to.be.ok;
        const afterVote = (await dao.proposalVotes(proposalId)).forVotes;
        expect(afterVote).to.be.equal(beforeVote.add(1));
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.true;
        expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
      });
      it("Prevents voting with tampered signatures", async () => {
        const beforeVoteAgainst = (await dao.proposalVotes(proposalId)).againstVotes;
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
        expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
        await advanceBlocks(VOTING_DELAY + 1);
        const ballot = {
          proposalId: proposalId,
          support: VOTE_FOR,
        };
        // alice signs a ballot with a vote "for"
        const signature = await alice._signTypedData(Domain(dao), Types, ballot);
        const { v, r, s } = ethers.utils.splitSignature(signature);
        // bob tries to mark it as vote "against"
        await expect(
          dao.connect(bob).castVoteBySig(proposalId, VOTE_AGAINST, v, r, s)
        ).to.be.revertedWith("Not a member or account too new");
        const afterVoteAgainst = (await dao.proposalVotes(proposalId)).againstVotes;
        expect(afterVoteAgainst).to.be.equal(beforeVoteAgainst);
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
        expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
      });
      it("Prevents voting with invalid signatures", async () => {
        expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
        expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
        await advanceBlocks(VOTING_DELAY + 1);
        const ballot = {
          proposalId: proposalId,
          support: VOTE_FOR,
        };
        const signature = await alice._signTypedData(Domain(dao), Types, ballot);
        const { v, r, s } = ethers.utils.splitSignature(signature);
        await expect(
          dao.connect(alice).castVoteBySig(proposalId, VOTE_FOR, 29, r, s)
        ).to.be.revertedWith("ECDSA: invalid signature");
      });
      describe("Bulk Signatures", () => {
        interface ballot {
          proposalId: BigNumber;
          support: BigNumber;
        }
        let aliceSig: string;
        let bobSig: string;
        let chrisSig: string;
        let proposerSig: string;
        let propVotes: [BigNumber, BigNumber, BigNumber] & {
          againstVotes: BigNumber;
          forVotes: BigNumber;
          abstainVotes: BigNumber;
        };
        let aliceBallot: ballot;
        let bobBallot: ballot;
        let chrisBallot: ballot;
        let proposerBallot: ballot;

        beforeEach(async () => {
          aliceBallot = {
            proposalId: proposalId,
            support: VOTE_FOR,
          };
          bobBallot = {
            proposalId: proposalId,
            support: VOTE_AGAINST,
          };
          chrisBallot = {
            proposalId: proposalId,
            support: VOTE_ABSTAIN,
          };
          proposerBallot = {
            proposalId: proposalId,
            support: VOTE_FOR,
          };
          aliceSig = await alice._signTypedData(Domain(dao), Types, aliceBallot);
          bobSig = await bob._signTypedData(Domain(dao), Types, bobBallot);
          chrisSig = await chris._signTypedData(Domain(dao), Types, chrisBallot);
          proposerSig = await proposer._signTypedData(Domain(dao), Types, proposerBallot);

          // await dao.connect(chris).buyMembership({ value: ONE_ETHER });
          propVotes = await dao.proposalVotes(proposalId);
        });
        it("Members are able to cast multple signed votes at a time", async () => {
          expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, chris.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, proposer.address)).to.be.false;
          expect(propVotes.abstainVotes).to.equal(0);
          expect(propVotes.forVotes).to.equal(0);
          expect(propVotes.againstVotes).to.equal(0);
          await advanceBlocks(VOTING_DELAY + 1);
          const sigs = [aliceSig, bobSig, chrisSig, proposerSig];
          const supports = [VOTE_FOR, VOTE_AGAINST, VOTE_ABSTAIN, VOTE_FOR];
          let vs = [];
          let rs = [];
          let ss = [];
          for (let i = 0; i < sigs.length; i++) {
            const { v, r, s } = ethers.utils.splitSignature(sigs[i]);
            vs.push(v);
            rs.push(r);
            ss.push(s);
          }
          expect(await dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 0, 4))
            .to.be.ok;
          expect(await dao.hasVoted(proposalId, alice.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, bob.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, chris.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, proposer.address)).to.be.true;
          propVotes = await dao.proposalVotes(proposalId);
          expect(propVotes.abstainVotes).to.equal(1);
          expect(propVotes.forVotes).to.equal(2);
          expect(propVotes.againstVotes).to.equal(1);
        });
        it("Allows vote counting to be done in multiple parts", async () => {
          await advanceBlocks(VOTING_DELAY + 1);
          const sigs = [aliceSig, bobSig, chrisSig, proposerSig];
          const supports = [VOTE_FOR, VOTE_AGAINST, VOTE_ABSTAIN, VOTE_FOR];
          let vs = [];
          let rs = [];
          let ss = [];
          for (let i = 0; i < sigs.length; i++) {
            const { v, r, s } = ethers.utils.splitSignature(sigs[i]);
            vs.push(v);
            rs.push(r);
            ss.push(s);
          }
          expect(await dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 0, 2))
            .to.be.ok;
          expect(await dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 2, 4))
            .to.be.ok;
          expect(await dao.hasVoted(proposalId, proposer.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, alice.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, bob.address)).to.be.true;
          expect(await dao.hasVoted(proposalId, chris.address)).to.be.true;
          propVotes = await dao.proposalVotes(proposalId);
          expect(propVotes.abstainVotes).to.equal(1);
          expect(propVotes.forVotes).to.equal(2);
          expect(propVotes.againstVotes).to.equal(1);
        });
        it("Prevents any vote from being counted if array contained 1+ invalid sig", async () => {
          await advanceBlocks(VOTING_DELAY + 1);
          const sigs = [aliceSig, bobSig, chrisSig, proposerSig];
          // change last one from FOR -> AGAINST
          const supports = [VOTE_FOR, VOTE_AGAINST, VOTE_ABSTAIN, VOTE_AGAINST];
          let vs = [];
          let rs = [];
          let ss = [];
          for (let i = 0; i < sigs.length; i++) {
            const { v, r, s } = ethers.utils.splitSignature(sigs[i]);
            vs.push(v);
            rs.push(r);
            ss.push(s);
          }
          await expect(
            dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 0, 4)
          ).to.be.revertedWith("Not a member or account too new");
          expect(await dao.hasVoted(proposalId, alice.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, bob.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, chris.address)).to.be.false;
          expect(await dao.hasVoted(proposalId, proposer.address)).to.be.false;
          expect(propVotes.abstainVotes).to.equal(0);
          expect(propVotes.forVotes).to.equal(0);
          expect(propVotes.againstVotes).to.equal(0);
        });
        it("Prevents from allowing mismatched param lengths", async () => {
          await advanceBlocks(VOTING_DELAY + 1);
          const sigs = [aliceSig, bobSig, chrisSig]; // missing proposerSig
          const supports = [VOTE_FOR, VOTE_AGAINST, VOTE_ABSTAIN, VOTE_FOR];
          let vs = [];
          let rs = [];
          let ss = [];
          for (let i = 0; i < sigs.length; i++) {
            const { v, r, s } = ethers.utils.splitSignature(sigs[i]);
            vs.push(v);
            rs.push(r);
            ss.push(s);
          }
          await expect(
            dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 0, 4)
          ).to.be.revertedWith("Invalid signature parameter lengths");
        });
        it("Prevents from allowing multiple of same votes", async () => {
          await advanceBlocks(VOTING_DELAY + 1);
          const sigs = [aliceSig, bobSig, bobSig]; // bob is included twice
          const supports = [VOTE_FOR, VOTE_AGAINST, VOTE_AGAINST];
          let vs = [];
          let rs = [];
          let ss = [];
          for (let i = 0; i < sigs.length; i++) {
            const { v, r, s } = ethers.utils.splitSignature(sigs[i]);
            vs.push(v);
            rs.push(r);
            ss.push(s);
          }
          await expect(
            dao.connect(proposer).castVotesBySig(proposalId, supports, vs, rs, ss, 0, 3)
          ).to.be.revertedWith("Account has already voted");
        });
      });
    });
    it("Members are able make a simple vote", async () => {
      await advanceBlocks(VOTING_DELAY + 1);
      expect(await dao.connect(bob).castVote(proposalId, VOTE_FOR)).to.be.ok;
    });
    it("Prevents members from voting with an invalid value", async () => {
      await advanceBlocks(VOTING_DELAY + 1);
      await expect(dao.connect(bob).castVote(proposalId, BigNumber.from("5"))).to.be.revertedWith(
        "Invalid value used for voting"
      );
    });
    it("Prevents members from voting more than once on a proposal", async () => {
      await advanceBlocks(VOTING_DELAY + 1);
      await dao.connect(bob).castVote(proposalId, VOTE_FOR);
      await expect(dao.connect(bob).castVote(proposalId, VOTE_FOR)).to.be.revertedWith(
        "Account has already voted"
      );
    });
    it("Prevents members from voting on an pending proposal", async () => {
      await expect(dao.connect(bob).castVote(proposalId, VOTE_FOR)).to.be.revertedWith(
        "Proposal must be active for a vote"
      );
    });
    it("Prevents members from voting on an inactive proposal", async () => {
      advanceBlocks(VOTING_PERIOD + VOTING_DELAY + 1);
      await expect(dao.connect(bob).castVote(proposalId, VOTE_FOR)).to.be.revertedWith(
        "Proposal must be active for a vote"
      );
    });
  });
  describe("Execution", () => {
    beforeEach(async () => {
      await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
      await dao.connect(alice).buyMembership({ value: ONE_ETHER });
      await dao.connect(bob).buyMembership({ value: ONE_ETHER });
      await dao.connect(chris).buyMembership({ value: ONE_ETHER });
      await dao.connect(david).buyMembership({ value: ONE_ETHER });
      await advanceBlocks(VOTING_PERIOD);
      let ABI = ["function currentMemberCount()"];
      let iface = new ethers.utils.Interface(ABI);
      callDatas = [iface.encodeFunctionData("currentMemberCount")];
      values = [ONE_ETHER.toString()];
      targets = [dao.address];
      proposalDescription = "check address balance";
      hash = ethers.utils.id(proposalDescription);
      proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
    });
    it("Able to execute arbitrary calls", async () => {
      values = ["0"];
      proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      const beforeBalance = await dao.provider.getBalance(dao.address);
      await passProposalWith(proposalId, VOTE_FOR);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      expect(await dao.connect(proposer).execute(targets, values, callDatas, hash)).to.be.ok;
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_EXECUTED);
      expect(await dao.provider.getBalance(dao.address)).to.equal(beforeBalance);
    });
    it("Prevents non-members from executing proposals", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await expect(
        dao.connect(investors[0]).execute(targets, values, callDatas, hash)
      ).to.be.revertedWith("Must be a member");
    });
    it("Prevents executing pending proposals", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_PENDING);
      await expect(dao.connect(alice).execute(targets, values, callDatas, hash)).to.be.revertedWith(
        "Proposal must be successful to execute"
      );
    });
    it("Prevents executing active proposals", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await advanceBlocks(VOTING_DELAY + 1);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_ACTIVE);
      await expect(dao.connect(alice).execute(targets, values, callDatas, hash)).to.be.revertedWith(
        "Proposal must be successful to execute"
      );
    });
    it("Prevents executing defeated proposals", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await advanceBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_DEFEATED);
      await expect(dao.connect(alice).execute(targets, values, callDatas, hash)).to.be.revertedWith(
        "Proposal must be successful to execute"
      );
    });
    it("Prevents executing executed proposals", async () => {
      values = ["0"];
      proposalId = await dao.connect(alice).hashProposal(targets, values, callDatas, hash);
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await passProposalWith(proposalId, VOTE_FOR);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      await dao.connect(proposer).execute(targets, values, callDatas, hash);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_EXECUTED);
      await expect(
        dao.connect(proposer).execute(targets, values, callDatas, hash)
      ).to.be.revertedWith("Proposal must be successful to execute");
    });
    it("Failing call fails and can be verified", async () => {
      targets = [nft.address];
      const badCalldata = [encodeParameters(["address"], [ZERO_ADDRESS])];
      const newPID = await dao.connect(proposer).hashProposal(targets, values, badCalldata, hash);
      expect(await dao.connect(proposer).propose(targets, values, badCalldata, proposalDescription))
        .to.be.ok;
      await passProposalWith(newPID, VOTE_FOR);
      expect(await dao.getState(newPID)).to.equal(PROPOSAL_SUCCEEDED);
      await expect(
        dao.connect(proposer).execute(targets, values, badCalldata, hash)
      ).to.be.revertedWith("Transaction execution reverted");
    });
    it("Certain calls return revert reason", async () => {
      targets = [dao.address];
      let ABI = ["function buyMembership()"];
      let iface = new ethers.utils.Interface(ABI);
      const xferCallData = [iface.encodeFunctionData("buyMembership")];
      const newPID = await dao.connect(proposer).hashProposal(targets, values, xferCallData, hash);
      await dao.connect(proposer).propose(targets, values, xferCallData, proposalDescription);
      await passProposalWith(newPID, VOTE_FOR);
      expect(await dao.getState(newPID)).to.equal(PROPOSAL_SUCCEEDED);
      await expect(
        dao.connect(proposer).execute(targets, values, xferCallData, hash)
      ).to.be.revertedWith("Transaction execution reverted");
    });
  });
  describe("Purchasing NFTs", () => {
    beforeEach(async () => {
      await dao.connect(proposer).buyMembership({ value: ONE_ETHER });
      await dao.connect(alice).buyMembership({ value: ONE_ETHER });
      await dao.connect(bob).buyMembership({ value: ONE_ETHER });
      await dao.connect(chris).buyMembership({ value: ONE_ETHER });
      await dao.connect(david).buyMembership({ value: ONE_ETHER });
      await advanceBlocks(VOTING_PERIOD + 1);
      targets = [nft.address];
      values = [ONE_ETHER.toString()];
      let ABI = ["function buy(address nftContract, uint256 nftId)"];
      // let ABI = ["function buy(address,uint256)"]; // this works too
      let iface = new ethers.utils.Interface(ABI);
      callDatas = [iface.encodeFunctionData("buy", [coolcatAddress, 100])];
      proposalId = await dao.connect(proposer).hashProposal(targets, values, callDatas, hash);
    });
    describe("NftMarketplaceMock contract", () => {
      it("OpenOcean deployed correctly.", async () => {
        expect(nft.address).to.be.ok;
      });
      it("Able to get price on NFTs", async () => {
        expect(await nft.callStatic.getPrice(coolcatAddress, BigNumber.from("1"))).to.equal(
          ONE_ETHER
        );
      });
      it("Reverts on a 777 nftId", async () => {
        await expect(
          nft.callStatic.getPrice(coolcatAddress, BigNumber.from("777"))
        ).to.be.revertedWith("Reverting for testing");
      });
      it("Able to buy NFTs directly", async () => {
        expect(
          await nft.callStatic.buy(coolcatAddress, BigNumber.from("100"), { value: ONE_ETHER })
        ).to.be.true;
      });
    });
    it("Able to execute a purchase by calling buy() function in mock contract", async () => {
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await passProposalWith(proposalId, VOTE_FOR);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      expect(await dao.connect(alice).execute(targets, values, callDatas, hash)).to.be.ok;
    });
    it("Able to execute purchaseNFT() function", async () => {
      const daoBalanceBefore = await dao.provider.getBalance(dao.address);
      targets = [dao.address];
      values = [ETH("2").toString()];
      let ABI = [
        "function purchaseNFT(address _marketAddress, address _nftContract, uint256 _tokenId, uint256 _maxPrice)",
      ];
      let iface = new ethers.utils.Interface(ABI);
      const out = [
        iface.encodeFunctionData("purchaseNFT", [nft.address, coolcatAddress, 100, ETH("2")]),
      ];
      const newPID = await dao.connect(proposer).hashProposal(targets, values, out, hash);
      await dao.connect(proposer).propose(targets, values, out, proposalDescription);
      await passProposalWith(newPID, VOTE_FOR);
      expect(await dao.getState(newPID)).to.equal(PROPOSAL_SUCCEEDED);
      await expect(dao.connect(alice).execute(targets, values, out, hash))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(newPID);
      const daoBalanceAfter = await dao.provider.getBalance(dao.address);
      expect(await nft.provider.getBalance(nft.address)).to.equal(ETH("1"));
      expect(daoBalanceAfter).to.equal(daoBalanceBefore.sub(ETH("1")));
    });
    it("Able to purchase multiple NFTs", async () => {
      targets = [dao.address, dao.address];
      values = [ETH("2").toString(), ETH("1.5").toString()];
      let ABI = [
        "function purchaseNFT(address _marketAddress, address _nftContract, uint256 _tokenId, uint256 _maxPrice)",
      ];
      const iface = new ethers.utils.Interface(ABI);
      callDatas = [
        iface.encodeFunctionData("purchaseNFT", [nft.address, coolcatAddress, 100, ETH("2")]),
      ];
      callDatas.push(
        iface.encodeFunctionData("purchaseNFT", [nft.address, coolcatAddress, 101, ETH("1.5")])
      );
      proposalId = await dao.connect(proposer).hashProposal(targets, values, callDatas, hash);
      await dao.connect(proposer).propose(targets, values, callDatas, proposalDescription);
      await passProposalWith(proposalId, VOTE_FOR);
      expect(await dao.getState(proposalId)).to.equal(PROPOSAL_SUCCEEDED);
      const results = await dao.connect(alice).callStatic.execute(targets, values, callDatas, hash);
      expect(results.length).to.equal(2);
      expect(
        iface.decodeFunctionResult(
          dao.interface.functions["purchaseNFT(address,address,uint256,uint256)"],
          results[0]
        )[0]
      ).to.be.true;
      expect(
        iface.decodeFunctionResult(
          dao.interface.functions["purchaseNFT(address,address,uint256,uint256)"],
          results[1]
        )[0]
      ).to.be.true;
    });
    it("Fails if NFT purchase is attempted but price is too high", async () => {
      targets = [dao.address];
      let ABI = [
        "function purchaseNFT(address _marketAddress, address _nftContract, uint256 _tokenId, uint256 _maxPrice)",
      ];
      let iface = new ethers.utils.Interface(ABI);
      const out = [
        iface.encodeFunctionData("purchaseNFT", [nft.address, coolcatAddress, 100, ETH("0.5")]),
      ];
      const newPID = await dao.connect(proposer).hashProposal(targets, values, out, hash);
      await dao.connect(proposer).propose(targets, values, out, proposalDescription);
      await passProposalWith(newPID, VOTE_FOR);
      expect(await dao.getState(newPID)).to.equal(PROPOSAL_SUCCEEDED);
      const results = await dao.connect(alice).callStatic.execute(targets, values, out, hash);
      const result = iface.decodeFunctionResult(
        dao.interface.functions["purchaseNFT(address,address,uint256,uint256)"],
        results[0]
      );
      expect(result[0]).to.be.false;
    });
  });
});
