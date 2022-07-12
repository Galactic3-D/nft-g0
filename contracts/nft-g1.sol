// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "erc721a/contracts/ERC721A.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./library/AddressString.sol";

contract NFTG0RARE is Ownable, ERC721A, ReentrancyGuard {
    uint256 public immutable maxPerAddressDuringMint;
    uint256 public immutable reserved;
    uint256 public immutable collectionSize;

    struct SaleConfig {
        uint32 whitelistSaleStartTime;
        uint32 publicSaleStartTime;
        uint64 priceWei;
        address whitelistSigner;
    }

    SaleConfig public config;

    // Reserved amount is counted separately and cannot be used in whitelist or public sale
    uint256 public mintedReservedTokens;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 collectionSize_,
        uint256 reserved_,
        uint256 maxPerAddressDuringMint_,
        uint64 priceWei_
    ) ERC721A(name_, symbol_) {
        reserved = reserved_;
        collectionSize = collectionSize_;
        maxPerAddressDuringMint = maxPerAddressDuringMint_;
        config.priceWei = priceWei_;

        require(reserved_ <= collectionSize_);

        mintedReservedTokens = 0;
    }

    function whitelistMint(
        uint256 quantity,
        uint256 approvedMaxQuantity,
        bytes memory signature
    ) external payable {
        uint256 price = uint256(config.priceWei);
        uint256 whitelistSaleStartTime = uint256(config.whitelistSaleStartTime);

        require(
            isSaleOn(whitelistSaleStartTime),
            "whitelist sale has not begun yet"
        );

        require(
            totalSupply() - mintedReservedTokens + quantity <=
                collectionSize - reserved,
            "not enough remaining reserved for sale to support desired mint amount"
        );

        require(
            numberMinted(msg.sender) + quantity <= approvedMaxQuantity,
            "can not mint this many"
        );

        bytes memory data = abi.encodePacked(
            Strings.toString(block.chainid),
            ":",
            AddressString.toAsciiString(msg.sender),
            ":",
            Strings.toString(approvedMaxQuantity)
        );
        bytes32 hash = ECDSA.toEthSignedMessageHash(data);
        address signer = ECDSA.recover(hash, signature);

        bytes memory errorMessage = abi.encodePacked(
            "wrong signature, expected message ",
            data,
            " signed by ",
            AddressString.toAsciiString(config.whitelistSigner)
        );
        require(signer == config.whitelistSigner, string(errorMessage));

        uint256 totalCost = price * quantity;
        _safeMint(msg.sender, quantity);
        refundIfOver(totalCost);
    }

    function mint(uint256 quantity) external payable {
        uint256 publicPrice = uint256(config.priceWei);
        uint256 publicSaleStartTime = uint256(config.publicSaleStartTime);

        require(isSaleOn(publicSaleStartTime), "sale has not begun yet");
        require(
            totalSupply() - mintedReservedTokens + quantity <=
                collectionSize - reserved,
            "reached max supply"
        );
        require(
            numberMinted(msg.sender) + quantity <= maxPerAddressDuringMint,
            "can not mint this many"
        );
        _safeMint(msg.sender, quantity);
        refundIfOver(publicPrice * quantity);
    }

    function refundIfOver(uint256 price) private {
        require(msg.value >= price, "Need to send more ETH.");
        if (msg.value > price) {
            payable(msg.sender).transfer(msg.value - price);
        }
    }

    function isSaleOn(uint256 _startTime) public view returns (bool) {
        return _startTime != 0 && block.timestamp >= _startTime;
    }

    function setPrice(uint64 price) external onlyOwner {
        config.priceWei = price;
    }

    function setWhitelistSaleConfig(uint32 timestamp, address signer)
        external
        onlyOwner
    {
        config.whitelistSaleStartTime = timestamp;
        config.whitelistSigner = signer;
    }

    function setPublicSaleConfig(uint32 timestamp) external onlyOwner {
        config.publicSaleStartTime = timestamp;
    }

    // For marketing etc.
    // Reserved tokens are counted separately and are not reused for whitelist or public sale
    function reserve(uint256 quantity) external onlyOwner {
        require(
            mintedReservedTokens + quantity <= reserved,
            "too many already minted before dev mint"
        );
        mintedReservedTokens += quantity;
        _safeMint(msg.sender, quantity);
    }

    // // metadata URI
    string private _baseTokenURI;

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        require(success, "Transfer failed.");
    }

    function numberMinted(address owner) public view returns (uint256) {
        return _numberMinted(owner);
    }

    function getOwnershipData(uint256 tokenId)
        external
        view
        returns (TokenOwnership memory)
    {
        return _ownershipOf(tokenId);
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function totalReservedMinted() external view returns (uint256) {
        return mintedReservedTokens;
    }
}
