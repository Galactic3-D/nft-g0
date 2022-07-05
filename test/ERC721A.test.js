const { deployContract } = require("./helpers.js");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = constants;
const { parseEther, formatEther } = ethers.utils;

const RECEIVER_MAGIC_VALUE = "0x150b7a02";
const GAS_MAGIC_VALUE = 20000;


let getCurrentTimestamp = async () => {
    // getting timestamp
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    return blockBefore.timestamp;
}

const createTestSuite = ({ contract, constructorArgs }) =>
    function () {
        context(`${contract}`, function () {
            beforeEach(async function () {
                this.erc721a = await deployContract(contract, constructorArgs);
                this.receiver = await deployContract("ERC721ReceiverMock", [RECEIVER_MAGIC_VALUE]);
                this.startTokenId = this.erc721a.startTokenId ? (await this.erc721a.startTokenId()).toNumber() : 0;
                const [owner, addr1, addr2] = await ethers.getSigners();
                this.owner = owner;
                this.addr1 = addr1;
                this.addr2 = addr2;
                const chainId = await getChainId();
                this.chainId = chainId;

                this.buildWhitelistApproval = (address, quantity) => {
                    return `${chainId}:${address.toUpperCase()}:${quantity}`;
                }
            });

            context("with no minted tokens", async function () {
                it("has 0 totalSupply", async function () {
                    const supply = await this.erc721a.totalSupply();
                    expect(supply).to.equal(0);
                });

                it("has 0 totalMinted", async function () {
                    const totalMinted = await this.erc721a.totalMinted();
                    expect(totalMinted).to.equal(0);
                });
            });

            context("ownership", async function() {
                it("default", async function() {
                    expect(await this.erc721a.owner()).to.be.equal(this.owner.address);
                });

                it("change", async function() {
                    await this.erc721a.transferOwnership(this.addr1.address);
                    await expect(this.erc721a.transferOwnership(this.addr1.address)).to.be.reverted;
                    expect(await this.erc721a.owner()).to.be.equal(this.addr1.address);
                });
            });

            context("reserve", async function () {

                it("in valid range and batch size", async function () {
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("0");
                    expect(await this.erc721a.totalMinted()).to.equal("0");
                    await this.erc721a.reserve(5);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("5");
                    expect(await this.erc721a.totalMinted()).to.equal("5");
                    await this.erc721a.reserve(10);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("15");
                    expect(await this.erc721a.totalMinted()).to.equal("15");
                });

                it("in valid range, but with wrong batch size", async function () {
                    await expect(this.erc721a.reserve(6)).to.be.revertedWith('can only mint a multiple of the maxBatchSize');
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("0");
                    expect(await this.erc721a.totalMinted()).to.equal("0");
                });

                it("over range, but valid batch size", async function () {
                    await expect(this.erc721a.reserve(100)).to.be.revertedWith('too many already minted before dev mint');
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("0");

                    await this.erc721a.reserve(20);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("20");

                    await expect(this.erc721a.reserve(5)).to.be.revertedWith('too many already minted before dev mint');
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("20");
                });

                it("from wrong user", async function () {
                    await this.erc721a.reserve(20);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("20");
                });

                it("transfer to another user", async function () {
                    await this.erc721a.reserve(5);
                    await this.erc721a.connect(this.owner).setApprovalForAll(this.addr1.address, true);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("5");
                    expect(await this.erc721a.ownerOf("2")).to.equal(this.owner.address);
                    this.transferTx = await this.erc721a.connect(this.addr1).transferFrom(this.owner.address, this.addr1.address, 2);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("4");
                    expect(await this.erc721a.ownerOf("2")).to.equal(this.addr1.address);
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                });
            });

            context("Whitelist sale", async function () {
                beforeEach(async function () {
                    const [owner, signer, addr1] = await ethers.getSigners();
                    let currentTime = await getCurrentTimestamp();
                    await this.erc721a.setPrice(parseEther("1"));
                    await this.erc721a.setWhitelistSaleConfig(
                        currentTime,
                        signer.address,
                    );
                    this.owner = owner;
                    this.addr1 = addr1;
                    this.signer = signer;
                });

                it("valid signature", async function () {
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");


                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    let tx = await this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    );
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                    expect(await this.erc721a.ownerOf("1")).to.equal(this.addr1.address);
                });

                it("invalid signature", async function () {
                    let signature = await this.owner.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('wrong sig');
                });

                it("valid signature, but invalid quantity", async function () {
                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        2,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('can not mint this many');
                });

                it("buying more than permited for one user", async function () {
                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 20)
                    );

                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        10,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('can not mint this many');
                });

                it("buying more than permited for all users", async function () {
                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 20)
                    );

                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        10,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('can not mint this many');

                });

                it("transfer to another user", async function () {
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");


                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    let tx = await this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    );
                    await this.erc721a.connect(this.addr1).setApprovalForAll(this.signer.address, true);
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                    await this.erc721a.connect(this.signer).transferFrom(this.addr1.address, this.signer.address, 1);
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");
                    expect(await this.erc721a.balanceOf(this.signer.address)).to.equal("1");
                    expect(await this.erc721a.ownerOf("1")).to.equal(this.signer.address);
                });

                it("change sale start date", async function () {
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");


                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    await this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    );

                    let currentTime = await getCurrentTimestamp();
                    await this.erc721a.setWhitelistSaleConfig(
                        currentTime + 60,
                        this.signer.address,
                    );

                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('whitelist sale has not begun yet');
                });

                it("withdraw from wrong address", async function () {
                    await expect(this.erc721a.connect(this.addr1).withdraw()).to.be.reverted;
                    await this.erc721a.withdraw();
                });
                it("withdraw accumulated", async function () {
                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    await this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    );

                    const userBalanceBefore = await ethers.provider.getBalance(this.owner.address);
                    const contractBalanceBefore = await ethers.provider.getBalance(this.erc721a.address);
                    expect(contractBalanceBefore).to.be.equal(parseEther('1'));
                    await this.erc721a.withdraw();
                    const userBalanceAfter = await ethers.provider.getBalance(this.owner.address);
                    const contractBalanceAfter = await ethers.provider.getBalance(this.erc721a.address);
                    expect(contractBalanceAfter).to.be.equal(parseEther('0'));
                    expect((userBalanceAfter-userBalanceBefore)/1e18).to.be.greaterThan(0);
                });

                it("reserve and mint", async function () {
                    await this.erc721a.reserve(20);
                    expect(await this.erc721a.balanceOf(this.owner.address)).to.equal("20");
                    expect(await this.erc721a.totalMinted()).to.equal("20");


                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );

                    await this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    );
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                    expect(await this.erc721a.ownerOf("21")).to.equal(this.addr1.address);
                    expect(await this.erc721a.totalMinted()).to.equal("21");
                });
            });

            context("Before whitelist sale", async function () {
                beforeEach(async function () {
                    const [owner, addr1, signer] = await ethers.getSigners();
                    this.addr1 = addr1;
                    this.signer = signer;
                    let currentTime = await getCurrentTimestamp();
                    await this.erc721a.setPrice(parseEther("1"));
                    await this.erc721a.setWhitelistSaleConfig(
                        currentTime + 60,
                        this.signer.address,
                    );

                });

                it("valid signature", async function () {
                    let signature = await this.signer.signMessage(
                        this.buildWhitelistApproval(this.addr1.address, 1)
                    );
                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('whitelist sale has not begun yet');
                });

                it("invalid signature", async function () {
                    let signature = await this.signer.signMessage(
                        `111${this.buildWhitelistApproval(this.addr1.address, 2)}`
                    );
                    await expect(this.erc721a.connect(this.addr1).whitelistMint(
                        1,
                        signature,
                        {value: parseEther("1.1")}
                    )).to.be.revertedWith('whitelist sale has not begun yet');
                });
            });

            context("Public sale", async function () {
                beforeEach(async function () {
                    const [owner, signer, addr1, addr2] = await ethers.getSigners();
                    this.owner = owner;
                    this.addr1 = addr1;
                    this.addr2 = addr2;
                    this.signer = signer;
                    let currentTime = await getCurrentTimestamp();
                    await this.erc721a.setPrice(parseEther("1"));
                    await this.erc721a.setWhitelistSaleConfig(
                        currentTime ,
                        this.signer.address,
                    );
                    await this.erc721a.setPublicSaleConfig(
                        currentTime,
                    );
                });

                it("enough money", async function () {
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");
                    await this.erc721a.connect(this.addr1).mint(1, {value: parseEther("4.0")});
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                });

                it("not enough money", async function () {
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");
                    await expect(
                        this.erc721a.connect(this.addr1).mint(1, {value: parseEther("0.3")})
                    ).to.be.revertedWith('Need to send more ETH.');
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("0");
                });

                it("get change", async function () {
                    await this.erc721a.connect(this.addr1).mint(1, {value: parseEther("5.0")});
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                });

                it("withdraw accumulated", async function () {
                    await this.erc721a.connect(this.addr1).mint(1, {value: parseEther("5.0")});
                    expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal("1");
                });

                it("change sale start date", async function () {
                    let currentTime = await getCurrentTimestamp();

                    await this.erc721a.connect(this.addr1).mint(1, {value: parseEther("5.0")});
                    await this.erc721a.setPublicSaleConfig(
                        currentTime + 60,
                    );
                    await expect(
                        this.erc721a.connect(this.addr1).mint(
                            1,
                            {value: parseEther("5.0")}
                        )
                    ).to.be.revertedWith('sale has not begun yet');
                });
            });
        });
    };

describe("ERC721A", createTestSuite({ contract: "NFTG0RARE", constructorArgs: ["NAME", "SYMBOL", 5, 200, 20] }));

