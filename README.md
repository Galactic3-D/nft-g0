# nft-g0
This is a basic ERC721A implemention, customized to a particular sale.
Originally forked from https://github.com/8gen/exv.battlepass.evm, thanks @kalloc for contribution.

1. install node modules `yarn install`
2. create .env file and enter required variables
3. run tests `npx hardhat test`
4. deploy on rinkeby `npx hardhat deploy --network rinkeby`
5. verify with parameters from constructor, for example `npx hardhat verify 0x_deployed_contract "NAME" "SYMBOL" 5 10000 50 --network rinkeby`


To check account balance: `npx hardhat check-balance`
