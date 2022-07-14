//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

contract Membership {
    uint256 public constant MEMBERSHIP_COST = 1 ether;

    uint256 public currentMemberCount = 0;
    mapping(address => uint256) public memberStartBlock;

    event NewMemberAdded(address indexed newMember, uint256 newMemberCount);

    modifier onlyMember(address account) {
        require(memberStartBlock[account] != 0, "Must be a member");
        _;
    }

    /**
     * @notice Purchase membership for exactly 1 ether
     * @dev Members cannot add or remove membership
     */
    function buyMembership() external payable {
        require(
            msg.sender != address(this),
            "Contract cannot purchase its own membership"
        );
        require(msg.sender != address(0), "Invalid account for membership"); //TODO: is this possible?
        require(msg.value == MEMBERSHIP_COST, "Cost of membership is 1 ETH");
        require(
            memberStartBlock[msg.sender] == 0,
            "Address is already a member"
        );
        currentMemberCount++;
        memberStartBlock[msg.sender] = block.number;
        emit NewMemberAdded(msg.sender, currentMemberCount);
    }
}
