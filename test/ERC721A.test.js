const { expect } = require('chai');
const { deployContract } = require('./helpers');

const { parseEther } = ethers.utils;

const RECEIVER_MAGIC_VALUE = '0x150b7a02';

const getCurrentTimestamp = async () => {
  // getting timestamp
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  return blockBefore.timestamp;
};

const createTestSuite = ({ contract, constructorArgs }) => function () {
  context(`${contract}`, () => {
    beforeEach(async function () {
      this.erc721a = await deployContract(contract, constructorArgs);
      this.receiver = await deployContract('ERC721ReceiverMock', [RECEIVER_MAGIC_VALUE]);
      this.startTokenId = this.erc721a.startTokenId ? (await this.erc721a.startTokenId()).toNumber() : 0;
      const [owner, addr1, addr2] = await ethers.getSigners();
      this.owner = owner;
      this.addr1 = addr1;
      this.addr2 = addr2;
      const { chainId } = await ethers.provider.getNetwork();
      this.chainId = chainId;

      this.buildWhitelistApproval = (address, quantity) => `${chainId}:${address.toUpperCase()}:${quantity}`;
    });

    context('with no minted tokens', async () => {
      it('has 0 totalSupply', async function () {
        const supply = await this.erc721a.totalSupply();
        expect(supply).to.equal(0);
      });

      it('has 0 totalMinted', async function () {
        const totalMinted = await this.erc721a.totalMinted();
        expect(totalMinted).to.equal(0);
      });
    });

    context('ownership', async () => {
      it('default', async function () {
        expect(await this.erc721a.owner()).to.be.equal(this.owner.address);
      });

      it('change', async function () {
        await this.erc721a.transferOwnership(this.addr1.address);
        await expect(this.erc721a.transferOwnership(this.addr1.address)).to.be.reverted;
        expect(await this.erc721a.owner()).to.be.equal(this.addr1.address);
      });
    });

    context('tokenURI', async () => {
      it('default', async function () {
        // create some tokens
        await this.erc721a.reserve(5);
        expect(await this.erc721a.totalMinted()).to.equal('5');

        expect(await this.erc721a.tokenURI(this.startTokenId)).to.be.equal('');

        const prefix = 'http://example.com/tokens/';
        await this.erc721a.setBaseURI(prefix);

        expect(await this.erc721a.tokenURI(this.startTokenId + 4)).to.be.equal(`${prefix}${this.startTokenId + 4}`);
        await expect(this.erc721a.tokenURI(this.startTokenId + 5)).to.be.revertedWith('URIQueryForNonexistentToken');

        const evilPrefix = 'http://evil.com/tokens';
        await expect(this.erc721a.connect(this.addr1).setBaseURI(evilPrefix))
          .to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    context('reserve', async () => {
      beforeEach(async function () {
        const [owner, addr1, addr2, signer] = await ethers.getSigners();
        this.owner = owner;
        this.addr1 = addr1;
        this.addr2 = addr2;
        this.signer = signer;
        const currentTime = await getCurrentTimestamp();
        await this.erc721a.setWhitelistSaleConfig(
          currentTime,
          this.signer.address,
        );
        await this.erc721a.setPublicSaleConfig(
          currentTime,
        );
      });

      it('mint reserved before everything', async function () {
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('0');
        expect(await this.erc721a.totalMinted()).to.equal('0');

        // mint batch 1
        await this.erc721a.reserve(5);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('5');
        expect(await this.erc721a.totalMinted()).to.equal('5');

        // mint batch 2
        await this.erc721a.reserve(15);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('20');
        expect(await this.erc721a.totalMinted()).to.equal('20');

        // try mint one more
        await expect(this.erc721a.reserve(1)).to.be.revertedWith('too many already minted before dev mint');
      });

      it('mint reserved after whitelist sale', async function () {
        const nTotal = 200;
        const nBatch1 = 5;
        const nBatch2 = 15;
        const nWhitelist = nTotal - nBatch1 - nBatch2;
        const price = parseEther('1');
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal(0);

        // minting reserved batch 1
        await this.erc721a.reserve(nBatch1);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal(nBatch1);
        expect(await this.erc721a.totalMinted()).to.equal(nBatch1);
        expect(await this.erc721a.ownerOf(this.startTokenId)).to.equal(this.owner.address);

        // minting whitelist batch
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, nTotal),
        );
        await this.erc721a.connect(this.addr1).whitelistMint(
          nWhitelist, nTotal, signature, { value: price.mul(nWhitelist) },
        );
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal(nWhitelist);
        expect(await this.erc721a.totalMinted()).to.equal(nBatch1 + nWhitelist);
        expect(await this.erc721a.ownerOf(this.startTokenId + nBatch1)).to.equal(this.addr1.address);
        expect(await this.erc721a.totalReservedMinted()).to.equal(nBatch1);

        // try whitelistMint one more
        await expect(
          this.erc721a.connect(this.addr1).whitelistMint(1, nTotal, signature, { value: price }),
        ).to.be.revertedWith('not enough remaining reserved for sale to support desired mint amount');

        // minting reserve batch 2
        await this.erc721a.reserve(nBatch2);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal(nBatch1 + nBatch2);
        expect(await this.erc721a.totalMinted()).to.equal(nTotal);
        expect(await this.erc721a.ownerOf(this.startTokenId + nBatch1 + nWhitelist)).to.equal(this.owner.address);

        // try mint one more
        await expect(this.erc721a.reserve(1)).to.be.revertedWith('too many already minted before dev mint');
        await expect(
          this.erc721a.connect(this.addr1).whitelistMint(1, nTotal, signature, { value: price }),
        ).to.be.revertedWith('not enough remaining reserved for sale to support desired mint amount');
      });

      it('mint reserved after public sale', async function () {
        const nTotal = 200;
        const nBatch1 = 5;
        const nBatch2 = 15;
        const nSale = nTotal - nBatch1 - nBatch2;
        const price = parseEther('1');
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal(0);

        // minting reserved batch 1
        await this.erc721a.reserve(nBatch1);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal(nBatch1);
        expect(await this.erc721a.totalMinted()).to.equal(nBatch1);
        expect(await this.erc721a.ownerOf(this.startTokenId)).to.equal(this.owner.address);

        // minting public sale batch
        await this.erc721a.connect(this.addr1).mint(nSale, { value: price.mul(nSale) });
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal(nSale);
        expect(await this.erc721a.totalMinted()).to.equal(nBatch1 + nSale);
        expect(await this.erc721a.ownerOf(this.startTokenId + nBatch1)).to.equal(this.addr1.address);
        expect(await this.erc721a.totalReservedMinted()).to.equal(nBatch1);

        // try mint one more
        await expect(
          this.erc721a.connect(this.addr1).mint(1, { value: price }),
        ).to.be.revertedWith('reached max supply');

        // minting reserve batch 2
        await this.erc721a.reserve(nBatch2);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal(nBatch1 + nBatch2);
        expect(await this.erc721a.totalMinted()).to.equal(nTotal);
        expect(await this.erc721a.ownerOf(this.startTokenId + nBatch1 + nSale)).to.equal(this.owner.address);

        // try mint one more
        await expect(this.erc721a.reserve(1)).to.be.revertedWith('too many already minted before dev mint');
        await expect(
          this.erc721a.connect(this.addr1).mint(1, { value: price }),
        ).to.be.revertedWith('reached max supply');
      });

      it('from wrong user', async function () {
        await this.erc721a.reserve(20);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('20');
      });

      it('transfer to another user', async function () {
        await this.erc721a.reserve(5);
        await this.erc721a.connect(this.owner).setApprovalForAll(this.addr1.address, true);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('5');
        expect(await this.erc721a.ownerOf(this.startTokenId + 1)).to.equal(this.owner.address);
        await this.erc721a.connect(this.addr1).transferFrom(
          this.owner.address, this.addr1.address, this.startTokenId + 1,
        );
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('4');
        expect(await this.erc721a.ownerOf(this.startTokenId + 1)).to.equal(this.addr1.address);
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
      });
    });

    context('Whitelist sale', async () => {
      beforeEach(async function () {
        const [owner, signer, addr1] = await ethers.getSigners();
        const currentTime = await getCurrentTimestamp();
        await this.erc721a.setPrice(parseEther('1'));
        await this.erc721a.setWhitelistSaleConfig(
          currentTime,
          signer.address,
        );
        this.owner = owner;
        this.addr1 = addr1;
        this.signer = signer;
      });

      it('valid signature', async function () {
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');

        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 2),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          2,
          signature,
          { value: parseEther('1.1') },
        );
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
        expect(await this.erc721a.ownerOf(this.startTokenId)).to.equal(this.addr1.address);
      });

      it('invalid signature', async function () {
        const data = this.buildWhitelistApproval(this.addr1.address, 2);
        const signature = await this.owner.signMessage(data);

        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          1,
          2,
          signature,
          { value: parseEther('1.1') },
        )).to.be.revertedWith(
          `wrong signature, expected message ${data} signed by ${this.signer.address.toUpperCase()}`,
        );
      });

      it('buying more than permited for one user', async function () {
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );

        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          2,
          1,
          signature,
          { value: parseEther('1.1') },
        )).to.be.revertedWith('can not mint this many');
      });

      it('buying when permitted amount is bigger than supply', async function () {
        // todo rewrite mint multiple but allowed quantity
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 201),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          201,
          signature,
          { value: parseEther('1.1') },
        );
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
        expect(await this.erc721a.ownerOf(this.startTokenId)).to.equal(this.addr1.address);
      });

      it('buying more than total token supply', async function () {
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 201),
        );

        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          201,
          201,
          signature,
          { value: parseEther('221.1') },
        )).to.be.revertedWith('not enough remaining reserved for sale');
      });

      it('transfer to another user', async function () {
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');

        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        );
        await this.erc721a.connect(this.addr1).setApprovalForAll(this.signer.address, true);
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
        await this.erc721a.connect(this.signer).transferFrom(
          this.addr1.address, this.signer.address, this.startTokenId,
        );
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');
        expect(await this.erc721a.balanceOf(this.signer.address)).to.equal('1');
        expect(await this.erc721a.ownerOf(this.startTokenId)).to.equal(this.signer.address);
      });

      it('change sale start date', async function () {
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');

        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        );

        const currentTime = await getCurrentTimestamp();
        await this.erc721a.setWhitelistSaleConfig(
          currentTime + 60,
          this.signer.address,
        );

        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        )).to.be.revertedWith('whitelist sale has not begun yet');
      });

      it('withdraw from wrong address', async function () {
        await expect(this.erc721a.connect(this.addr1).withdraw()).to.be.reverted;
        await this.erc721a.withdraw();
      });
      it('withdraw accumulated', async function () {
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        );

        const userBalanceBefore = await ethers.provider.getBalance(this.owner.address);
        const contractBalanceBefore = await ethers.provider.getBalance(this.erc721a.address);
        expect(contractBalanceBefore).to.be.equal(parseEther('1'));
        await this.erc721a.withdraw();
        const userBalanceAfter = await ethers.provider.getBalance(this.owner.address);
        const contractBalanceAfter = await ethers.provider.getBalance(this.erc721a.address);
        expect(contractBalanceAfter).to.be.equal(parseEther('0'));
        expect((userBalanceAfter - userBalanceBefore) / 1e18).to.be.greaterThan(0);
      });

      it('reserve and mint', async function () {
        await this.erc721a.reserve(20);
        expect(await this.erc721a.balanceOf(this.owner.address)).to.equal('20');
        expect(await this.erc721a.totalMinted()).to.equal('20');

        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );

        await this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        );
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
        expect(await this.erc721a.ownerOf(this.startTokenId + 20)).to.equal(this.addr1.address);
        expect(await this.erc721a.totalMinted()).to.equal('21');
      });
    });

    context('Before whitelist sale', async () => {
      beforeEach(async function () {
        const [_owner, addr1, signer] = await ethers.getSigners();
        this.addr1 = addr1;
        this.signer = signer;
        const currentTime = await getCurrentTimestamp();
        await this.erc721a.setPrice(parseEther('1'));
        await this.erc721a.setWhitelistSaleConfig(
          currentTime + 60,
          this.signer.address,
        );
      });

      it('valid signature', async function () {
        const signature = await this.signer.signMessage(
          this.buildWhitelistApproval(this.addr1.address, 1),
        );
        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        )).to.be.revertedWith('whitelist sale has not begun yet');
      });

      it('invalid signature', async function () {
        const signature = await this.signer.signMessage(
          `111${this.buildWhitelistApproval(this.addr1.address, 2)}`,
        );
        await expect(this.erc721a.connect(this.addr1).whitelistMint(
          1,
          1,
          signature,
          { value: parseEther('1.1') },
        )).to.be.revertedWith('whitelist sale has not begun yet');
      });
    });

    context('Public sale', async () => {
      beforeEach(async function () {
        const [owner, signer, addr1, addr2] = await ethers.getSigners();
        this.owner = owner;
        this.addr1 = addr1;
        this.addr2 = addr2;
        this.signer = signer;
        const currentTime = await getCurrentTimestamp();
        await this.erc721a.setPrice(parseEther('1'));
        await this.erc721a.setWhitelistSaleConfig(
          currentTime,
          this.signer.address,
        );
        await this.erc721a.setPublicSaleConfig(
          currentTime,
        );
      });

      it('enough money', async function () {
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');
        await this.erc721a.connect(this.addr1).mint(1, { value: parseEther('4.0') });
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
      });

      it('not enough money', async function () {
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');
        await expect(
          this.erc721a.connect(this.addr1).mint(1, { value: parseEther('0.3') }),
        ).to.be.revertedWith('Need to send more ETH.');
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('0');
      });

      it('get change', async function () {
        await this.erc721a.connect(this.addr1).mint(1, { value: parseEther('5.0') });
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
      });

      it('withdraw accumulated', async function () {
        await this.erc721a.connect(this.addr1).mint(1, { value: parseEther('5.0') });
        expect(await this.erc721a.balanceOf(this.addr1.address)).to.equal('1');
      });

      it('change sale start date', async function () {
        const currentTime = await getCurrentTimestamp();

        await this.erc721a.connect(this.addr1).mint(1, { value: parseEther('5.0') });
        await this.erc721a.setPublicSaleConfig(
          currentTime + 60,
        );
        await expect(
          this.erc721a.connect(this.addr1).mint(
            1,
            { value: parseEther('5.0') },
          ),
        ).to.be.revertedWith('sale has not begun yet');
      });
    });
  });
};

describe(
  'ERC721A',
  createTestSuite({
    contract: 'NFTG0RARE',
    constructorArgs: ['NAME', 'SYMBOL', 200, 20, 100_000, parseEther('0.1')],
  }),
);
