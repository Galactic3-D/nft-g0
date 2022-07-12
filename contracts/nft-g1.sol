// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import 'erc721a/contracts/ERC721A.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

import './library/AddressString.sol';

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

    // metadata URI
    string private _baseTokenURI;

    event SetPrice(uint64 indexed price);
    event SetWhitelistSaleConfig(uint32 indexed timestamp, address indexed signer);
    event SetPublicSaleConfig(uint32 indexed timestamp);
    event SetBaseURI(string indexed baseURI);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 collectionSize_,
        uint256 reserved_,
        uint256 maxPerAddressDuringMint_,
        uint64 priceWei_
    ) ERC721A(name_, symbol_) {
        require(reserved_ <= collectionSize_);

        collectionSize = collectionSize_;
        reserved = reserved_;
        maxPerAddressDuringMint = maxPerAddressDuringMint_;
        config.priceWei = priceWei_;

        mintedReservedTokens = 0;
    }

    function whitelistMint(
        uint256 quantity,
        uint256 approvedMaxQuantity,
        bytes memory signature
    ) external payable {
        uint256 price = uint256(config.priceWei);
        uint256 whitelistSaleStartTime = uint256(config.whitelistSaleStartTime);

        require(isSaleOn(whitelistSaleStartTime), 'whitelist sale has not begun yet');

        require(
            totalSupply() - mintedReservedTokens + quantity <= collectionSize - reserved,
            'not enough remaining reserved for sale to support desired mint amount'
        );

        require(numberMinted(msg.sender) + quantity <= approvedMaxQuantity, 'can not mint this many');

        bytes memory data = abi.encodePacked(
            Strings.toString(block.chainid),
            ':',
            AddressString.toAsciiString(msg.sender),
            ':',
            Strings.toString(approvedMaxQuantity)
        );
        bytes32 hash = ECDSA.toEthSignedMessageHash(data);
        address signer = ECDSA.recover(hash, signature);

        if (signer != config.whitelistSigner) {
            bytes memory errorMessage = abi.encodePacked(
                'wrong signature, expected message ',
                data,
                ' signed by ',
                AddressString.toAsciiString(config.whitelistSigner)
            );
            revert(string(errorMessage));
        }

        uint256 totalCost = price * quantity;
        _safeMint(msg.sender, quantity);
        refundIfOver(totalCost);
    }

    function mint(uint256 quantity) external payable {
        uint256 publicPrice = uint256(config.priceWei);
        uint256 publicSaleStartTime = uint256(config.publicSaleStartTime);

        require(isSaleOn(publicSaleStartTime), 'sale has not begun yet');
        require(totalSupply() - mintedReservedTokens + quantity <= collectionSize - reserved, 'reached max supply');
        require(numberMinted(msg.sender) + quantity <= maxPerAddressDuringMint, 'can not mint this many');
        _safeMint(msg.sender, quantity);
        refundIfOver(publicPrice * quantity);
    }

    function setPrice(uint64 price) external onlyOwner {
        config.priceWei = price;
        emit SetPrice(price);
    }

    function setWhitelistSaleConfig(uint32 timestamp, address signer) external onlyOwner {
        config.whitelistSaleStartTime = timestamp;
        config.whitelistSigner = signer;
        emit SetWhitelistSaleConfig(timestamp, signer);
    }

    function setPublicSaleConfig(uint32 timestamp) external onlyOwner {
        config.publicSaleStartTime = timestamp;
        emit SetPublicSaleConfig(timestamp);
    }

    // For marketing etc.
    // Reserved tokens are counted separately and are not reused for whitelist or public sale
    function reserve(uint256 quantity) external onlyOwner {
        require(mintedReservedTokens + quantity <= reserved, 'too many already minted before dev mint');
        mintedReservedTokens += quantity;
        _safeMint(msg.sender, quantity);
    }

    function setBaseURI(string calldata baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
        emit SetBaseURI(baseURI);
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool success, ) = msg.sender.call{value: address(this).balance}('');
        require(success, 'Transfer failed.');
    }

    function getOwnershipData(uint256 tokenId) external view returns (TokenOwnership memory) {
        return _ownershipOf(tokenId);
    }

    function totalMinted() external view returns (uint256) {
        return _totalMinted();
    }

    function totalReservedMinted() external view returns (uint256) {
        return mintedReservedTokens;
    }

    function isSaleOn(uint256 _startTime) public view returns (bool) {
        return _startTime != 0 && block.timestamp >= _startTime;
    }

    function numberMinted(address owner) public view returns (uint256) {
        return _numberMinted(owner);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function refundIfOver(uint256 price) private {
        require(msg.value >= price, 'Need to send more ETH.');
        if (msg.value > price) {
            (bool success, ) = msg.sender.call{value: msg.value - price}('');
            require(success, 'Transfer failed.');
        }
    }
}
