// deploy/00_deploy_my_contract.js
module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  await deploy('NFTG0RARE', {
    from: deployer,
    args: ['NFTG0RARE', 'RARES', 100, 10000, 200],
    log: true,
  });
};
module.exports.tags = ['nft'];
