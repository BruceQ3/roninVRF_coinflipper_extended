import {time, loadFixture, mine} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {anyValue} from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {expect} from "chai";
import {ethers} from "hardhat";
import {CoinFlipper, ERC20, ERC721} from "../typechain-types";
import {MaxUint256, Signer} from "ethers";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";

describe("CoinFlipper", function () {
	async function deployCoinFlipper() {
		const degenToken = "0x0000000000000000000000000000000000000000";
		const vrfCoordinator = "0x0000000000000000000000000000000000000000";

		const [owner, player] = await ethers.getSigners();

		const CoinFlipper = await ethers.getContractFactory("CoinFlipperLocal");
		const FakeERC20 = await ethers.getContractFactory("FakeERC20");
		const FakeERC721 = await ethers.getContractFactory("FakeERC721");
		const cf = await CoinFlipper.deploy();
		const erc20 = await FakeERC20.deploy();
		const erc721 = await FakeERC721.deploy();

		// init contract
		await cf.initialize(owner.address, vrfCoordinator, degenToken);

		// initial fund of contract
		await owner.sendTransaction({
			to: cf.getAddress(),
			value: ethers.parseEther("1000"),
		});

		//initial fund to player
		await erc20.transfer(player.address, ethers.parseEther("100"));
		for (let i = 1; i <= 50; i += 1) {
			await erc721.transferFrom(owner.address, player.address, i);
		}

		return {cf, owner, player, erc20, erc721};
	}

	// ---------- DEPLOYMENT ----------

	describe("Deployment", function () {
		it("Should set the right owner", async function () {
			const {cf, owner} = await loadFixture(deployCoinFlipper);

			expect(await cf.owner()).to.equal(owner.address);
		});

		it("Should have a balance of 1000 ron", async function () {
			const {cf, owner} = await loadFixture(deployCoinFlipper);

			expect(await ethers.provider.getBalance(cf.getAddress())).to.equal(ethers.parseEther("1000"));
		});

		it("Player should have a balance of 100 fake erc20", async function () {
			const {player, erc20} = await loadFixture(deployCoinFlipper);

			expect(await erc20.balanceOf(player.address)).to.equal(ethers.parseEther("100"));
		});

		it("Player should have a balance of 50 fake erc721", async function () {
			const {player, erc721} = await loadFixture(deployCoinFlipper);

			expect(await erc721.balanceOf(player.address)).to.equal(50);
		});
	});

	// ---------- ADMIN ----------

	describe("Admin Functions", function () {
		describe("Create configs", function () {
			it("Should create a RON config successfully", async function () {
				const {cf, owner} = await loadFixture(deployCoinFlipper);

				const configId = await addRonConfig(cf, owner);

				const cfConfig = await cf.coinFlipConfigs(configId);

				expect(cfConfig.supply).to.equal(configs[configId].supply);
				expect(cfConfig.tokenType).to.equal(configs[configId].tokenType);
				expect(await ethers.provider.getBalance(cf.getAddress())).to.equal(
					ethers.parseEther("2000")
				);
			});

			it("Should create a ERC20 config successfully", async function () {
				const {cf, erc20} = await loadFixture(deployCoinFlipper);

				const configId = await addERC20Config(cf, erc20);

				const cfConfig = await cf.coinFlipConfigs(configId);

				expect(cfConfig.supply).to.equal(configs[configId].supply);
				expect(cfConfig.tokenType).to.equal(configs[configId].tokenType);
				expect(await erc20.balanceOf(cf.getAddress())).to.equal(
					cfConfig.tokenAmount * cfConfig.supply
				);
			});

			it("Should create a ERC721 config successfully", async function () {
				const {cf, erc721, owner} = await loadFixture(deployCoinFlipper);

				const configId = await addERC721Config(cf, erc721, owner);

				const cfConfig = await cf.coinFlipConfigs(configId);

				expect(cfConfig.supply).to.equal(configs[configId].supply);
				expect(cfConfig.tokenType).to.equal(configs[configId].tokenType);
				expect(await erc721.balanceOf(cf.getAddress())).to.equal(
					cfConfig.tokenAmount * cfConfig.supply
				);
			});
		});
	});

	// ---------- PLAYER ----------

	describe("Player Functions", function () {
		describe("Play configs", function () {
			it("Should play a few RON configs successfully", async function () {
				const {cf, owner, player} = await loadFixture(deployCoinFlipper);

				const configId = await addRonConfig(cf, owner);

				const config = await cf.coinFlipConfigs(configId);
				const playerCf = cf.connect(player);
				const originalContractBalance = await ethers.provider.getBalance(await cf.getAddress());
				let playerWins = 0;
				let contractWins = 0;

				for (let i = 0; i < 100; i += 1) {
					const playerBalance = await ethers.provider.getBalance(player.address);
					const cfBalance = await ethers.provider.getBalance(await cf.getAddress());
					await playerCf.flipACoin(true, configId, 0, {
						value: config.tokenAmount + BigInt(calculateFee(config.tokenAmount)),
					});
					const newPlayerBalance = await ethers.provider.getBalance(player.address);
					const newCfBalance = await ethers.provider.getBalance(await cf.getAddress());

					if (newPlayerBalance > playerBalance) {
						// console.log("Player won!");
						playerWins += 1;
						expect(newCfBalance).to.equal(cfBalance - config.tokenAmount);
					} else {
						// console.log("Player lost!");
						contractWins += 1;
						expect(newCfBalance).to.equal(cfBalance + config.tokenAmount);
					}
					// console.log("Player new Balance: ", ethers.formatEther(newPlayerBalance.toString()));

					await mine(Math.floor(Math.random() * 20));
				}

				const currentContractBalance = await ethers.provider.getBalance(await cf.getAddress());
				const amountContractWon = ethers.getBigInt(contractWins) * config.tokenAmount;
				const amountContractLost = ethers.getBigInt(playerWins) * config.tokenAmount;
				const expectedContractBalance =
					originalContractBalance + amountContractWon - amountContractLost;

				// console.log(playerWins, contractWins, contractWins - playerWins, currentContractBalance, expectedContractBalance);
				expect(currentContractBalance).to.equal(expectedContractBalance);
			});

			it("Should play a few ERC20 configs successfully", async function () {
				const {cf, erc20, player} = await loadFixture(deployCoinFlipper);

				const configId = await addERC20Config(cf, erc20);

				const config = await cf.coinFlipConfigs(configId);
				const playerCf = cf.connect(player);
				const originalContractBalance = await erc20.balanceOf(await cf.getAddress());
				let playerWins = 0;
				let contractWins = 0;

				await erc20.connect(player).approve(await playerCf.getAddress(), MaxUint256);

				for (let i = 0; i < 100; i += 1) {
					const playerBalance = await erc20.balanceOf(player.address);
					const cfBalance = await erc20.balanceOf(await cf.getAddress());
					await playerCf.flipACoin(true, configId, 0);
					const newPlayerBalance = await erc20.balanceOf(player.address);
					const newCfBalance = await erc20.balanceOf(await cf.getAddress());

					if (newPlayerBalance > playerBalance) {
						// console.log("Player won!");
						playerWins += 1;
						expect(newCfBalance).to.equal(cfBalance - config.tokenAmount);
					} else {
						// console.log("Player lost!");
						contractWins += 1;
						expect(newCfBalance).to.equal(cfBalance + config.tokenAmount);
					}
					// console.log("Player new Balance: ", ethers.formatEther(newPlayerBalance.toString()));

					await mine(Math.floor(Math.random() * 20));
				}

				const currentContractBalance = await erc20.balanceOf(await cf.getAddress());
				const amountContractWon = ethers.getBigInt(contractWins) * config.tokenAmount;
				const amountContractLost = ethers.getBigInt(playerWins) * config.tokenAmount;
				const expectedContractBalance =
					originalContractBalance + amountContractWon - amountContractLost;

				// console.log(playerWins,contractWins,contractWins - playerWins,currentContractBalance,expectedContractBalance);
				expect(currentContractBalance).to.equal(expectedContractBalance);
			});

			it("Should play a few ERC721 configs successfully", async function () {
				const {cf, erc721, player, owner} = await loadFixture(deployCoinFlipper);

				const configId = await addERC721Config(cf, erc721, owner);

				const config = await cf.coinFlipConfigs(configId);
				const playerCf = cf.connect(player);
				const cfAddress = await cf.getAddress();
				const originalContractBalance = await erc721.balanceOf(await cf.getAddress());
				const originalNftSupply = config.supply;
				let playerWins = 0;
				let contractWins = 0;

				await erc721.connect(player).setApprovalForAll(await playerCf.getAddress(), true);

				for (let i = 0; i < 100; i += 1) {
					const playerBalance = await erc721.balanceOf(player.address);
					const cfBalance = await erc721.balanceOf(await cf.getAddress());

					const playerFirstNft = await erc721.tokenOfOwnerByIndex(player.address, 0);
					// console.log(playerFirstNft);
					await playerCf.flipACoin(true, configId, playerFirstNft);
					const newPlayerBalance = await erc721.balanceOf(player.address);
					const newCfBalance = await erc721.balanceOf(await cf.getAddress());

					if (newPlayerBalance > playerBalance) {
						// console.log("Player won!");
						playerWins += 1;
						expect(newCfBalance).to.equal(cfBalance - config.tokenAmount);
					} else {
						// console.log("Player lost!");
						contractWins += 1;
						expect(newCfBalance).to.equal(cfBalance + config.tokenAmount);
					}
					// console.log("Player new Balance: ", newPlayerBalance.toString());

					await mine(Math.floor(Math.random() * 20));
				}

				// playLog check.
				const playHistory = await cf.playHistory(player.address);
				expect(playHistory[0]).to.equal(100);



				const currentContractBalance = await erc721.balanceOf(await cf.getAddress());
				const amountContractWon = ethers.getBigInt(contractWins) * config.tokenAmount;
				const amountContractLost = ethers.getBigInt(playerWins) * config.tokenAmount;
				const expectedContractBalance =
					originalContractBalance + amountContractWon - amountContractLost;

				// console.log(
				// 	playerWins,
				// 	contractWins,
				// 	contractWins - playerWins,
				// 	currentContractBalance,
				// 	expectedContractBalance
				// );
				expect(currentContractBalance).to.equal(expectedContractBalance);

				// Check for config's tokenIndexes
				const nftSupply = (await cf.coinFlipConfigs(configId)).supply;
				expect(nftSupply).to.equal(originalNftSupply + amountContractWon - amountContractLost);
				// console.log(nftSupply);
				expect(nftSupply).to.equal(currentContractBalance);

				for (let i = 0; i < nftSupply; i += 1) {
					const tokenId = await cf.tokenOfConfigByIndex(configId, i);
					const ownerOfToken = await erc721.ownerOf(tokenId);

					// console.log('for ID %s | owner is %s', tokenId, ownerOfToken);
					expect(ownerOfToken).to.be.equal(cfAddress);
				}
				for (let i = nftSupply; i < 100; i += BigInt(1)) {
					const tokenId = await cf.tokenOfConfigByIndex(configId, i);
					// console.log('ID %s', tokenId);
					expect(tokenId).to.equal(0);
				}
			});
		});
	});
});

// ---------- HELPERS ----------

const configs = [
	{
		tokenType: 1,
		tokenAddress: "0x0000000000000000000000000000000000000000",
		tokenId: 0,
		tokenAmount: ethers.toBigInt(ethers.parseEther("10")),
		supply: ethers.toBigInt(100),
	},
	{
		tokenType: 20,
		tokenAddress: "",
		tokenId: 0,
		tokenAmount: ethers.toBigInt(ethers.parseEther("1")),
		supply: ethers.toBigInt(100),
	},
	{
		tokenType: 721,
		tokenAddress: "",
		tokenId: 0,
		tokenAmount: ethers.toBigInt("1"),
		supply: ethers.toBigInt(50),
	},
];

async function addRonConfig(cf: CoinFlipper, owner: HardhatEthersSigner) {
	const id = 0;
	const config = configs[id];

	await cf.updateCoinFlipConfigs([id], [config]);

	// fund contract for this config
	await owner.sendTransaction({
		to: cf.getAddress(),
		value: config.tokenAmount * config.supply,
	});

	expect((await cf.coinFlipConfigs(id)).supply).to.be.equal(config.supply);
	return id;
}

async function addERC20Config(cf: CoinFlipper, erc20: ERC20) {
	const id = 1;
	const config = configs[id];

	config.tokenAddress = await erc20.getAddress();

	await cf.updateCoinFlipConfigs([id], [config]);

	// fund contract for this config
	await erc20.transfer(await cf.getAddress(), config.tokenAmount * config.supply);

	expect((await cf.coinFlipConfigs(id)).supply).to.be.equal(config.supply);
	return id;
}

async function addERC721Config(cf: CoinFlipper, erc721: ERC721, owner: HardhatEthersSigner) {
	const id = 2;
	const config = configs[id];
	const indexes: number[] = [];
	const ids: number[] = [];
	let counter = 0;

	const cfAddress = await cf.getAddress();
	config.tokenAddress = await erc721.getAddress();

	// fund contract for this config
	for (let i = 51; i <= 100; i += 1) {
		await erc721.transferFrom(owner.address, cfAddress, i);
		indexes.push(counter);
		ids.push(i);
		counter += 1;
	}

	await cf.updateNftCoinFlipConfig(id, config, indexes, ids);

	expect((await cf.coinFlipConfigs(id)).supply).to.be.equal(config.supply);
	return id;
}

function calculateFee (amount: BigInt) {
	return Number(amount) * 0.04;
}
