//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.9;

import "hardhat/console.sol";
import "./NftMarketplace.sol";

/// @notice This contract is purely for testing purposes only
contract OpenOcean is INftMarketplace {
    uint256 lastBuyID = 0;

    /// @notice getPrice() will always say any NFT is worth 1 ether.
    /// @dev funtion will revert if nftId 777 is given
    function getPrice(
        address, /*nftContract*/
        uint256 nftId
    ) external pure override returns (uint256 price) {
        // console.log(
        //     "getPrice() called. NFT Contract: %s, ID: %d",
        //     nftContract,
        //     nftId
        // );

        require(nftId != 777, "Reverting for testing");
        return 1 ether;
    }

    /// @notice returns if msg.value is >= 1 ether
    /// @dev will revert if no ether is provided
    function buy(
        address, /*nftContract*/
        uint256 /*nftId*/
    ) external payable override returns (bool success) {
        require(msg.value > 0, "Insufficient funds");
        // console.log(
        //     "buy() called. NFT Contract: %s, ID: %d msg.value: %d",
        //     nftContract,
        //     nftId,
        //     msg.value
        // );
        return msg.value >= 1 ether;
    }
}
