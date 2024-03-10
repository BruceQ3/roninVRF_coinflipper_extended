// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Uncomment this line to use console.log
// import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./VRFConsumer.sol";

contract CoinFlipper is
	OwnableUpgradeable,
	ERC1155Holder,
	ERC721Holder,
	VRFConsumer
{
	// ---------- Contract Variables ----------

	struct CoinFlipConfig {
		uint256 tokenType; // 1 = Ron | 20 = ERC20 | 721 = ERC721 | 1155 = ERC1155
		address tokenAddress; // contract address of reward | 0x if non applicable
		uint256 tokenId; // ERC1155 ID | 0 if non applicable
		uint256 tokenAmount; // amount of token to be rewarded
		uint256 supply; // supply of this token available
	}

	struct VRFCoinFlipData {
		bool fulfilled;
		bool choice;
		uint16 configId;
		address player;
		uint256 nftId;
	}

	mapping(uint16 configId => CoinFlipConfig config) public coinFlipConfigs;
	mapping(uint16 configId => mapping(uint256 index => uint256 id))
		public tokenOfConfigByIndex;

	mapping(bytes32 reqHash => VRFCoinFlipData data) public coinFlipData;
	mapping(address player => uint256 winStreak) public playersWinStreak;

	bool coinFlipPaused;

	// ---------- Initializer ----------

	function initialize(
		address _owner,
		address _vrfCoordinator
	) public initializer {
		__Ownable_init(_owner);
		vrfCoordinator = _vrfCoordinator;
	}

	// ---------- Admin functions ----------

	function updateCoinFlipConfigs(
		uint16[] calldata _configIds,
		CoinFlipConfig[] calldata _configs
	) external onlyOwner {
		for (uint256 i = 0; i < _configIds.length; i += 1) {
			coinFlipConfigs[_configIds[i]] = _configs[i];
		}
	}

	function updateNftCoinFlipConfig(
		uint16 _configId,
		CoinFlipConfig calldata _config,
		uint256[] calldata _indexes,
		uint256[] calldata _ids
	) external onlyOwner {
		coinFlipConfigs[_configId] = _config;
		for (uint256 i = 0; i < _indexes.length; i += 1) {
			tokenOfConfigByIndex[_configId][_indexes[i]] = _ids[i];
		}
	}

	function deleteCoinFlipConfigs(
		uint16[] calldata _configIds
	) external onlyOwner {
		for (uint256 i = 0; i < _configIds.length; i += 1) {
			delete coinFlipConfigs[_configIds[i]];
		}
	}

	function togglePauseFlipping(bool _value) external onlyOwner {
		coinFlipPaused = _value;
	}

	function rescueAssets(
		uint256[] calldata _tokenTypes,
		address[] calldata _tokenAddresses,
		uint256[] calldata _tokenIds,
		uint256[] calldata _tokenAmounts
	) external onlyOwner {
		for (uint256 i = 0; i < _tokenTypes.length; i += 1) {
			if (_tokenTypes[i] == 1) {
				payable(msg.sender).transfer(_tokenAmounts[i]);
			} else if (_tokenTypes[i] == 20) {
				IERC20(_tokenAddresses[i]).transfer(msg.sender, _tokenAmounts[i]);
			} else if (_tokenTypes[i] == 721) {
				IERC721(_tokenAddresses[i]).safeTransferFrom(
					address(this),
					msg.sender,
					_tokenIds[i]
				);
			} else if (_tokenTypes[i] == 1155) {
				IERC1155(_tokenAddresses[i]).safeTransferFrom(
					address(this),
					msg.sender,
					_tokenIds[i],
					_tokenAmounts[i],
					""
				);
			}
		}
	}

	// ---------- User functions ----------

	function flipACoin(
		bool _choice,
		uint16 _configId,
		uint256 _nftId // 0 for any other type than 721
	) external payable returns (bytes32) {
		CoinFlipConfig storage config = coinFlipConfigs[_configId];
		require(!coinFlipPaused, "coin flips are paused");
		require(config.supply != 0, "supply empty");
		if (config.tokenType == 1) {
			require(address(this).balance > config.tokenAmount);
		}

		_takeAsset(config, _nftId);

		config.supply -= 1;

		uint256 value = IRoninVRFCoordinatorForConsumers(vrfCoordinator)
			.estimateRequestRandomFee(
				500000, // TODO -> need more accurate
				20 gwei
			);

		bytes32 reqHash = _requestRandomness(value, 500000, 20 gwei, address(this));
		coinFlipData[reqHash] = VRFCoinFlipData(
			false,
			_choice,
			_configId,
			msg.sender,
			_nftId
		);

		return reqHash;
	}

	// ---------- VRF function override ----------

	function _fulfillRandomSeed(
		bytes32 _reqHash,
		uint256 _randomSeed
	) internal override {
		VRFCoinFlipData storage data = coinFlipData[_reqHash];
		require(!data.fulfilled, "Order already fulfilled");

		data.fulfilled = true;

		uint256 result = _randomSeed % 2;
		uint256 userChoice = data.choice ? 1 : 0;

		if (result == userChoice) {
			_giveAsset(data, _randomSeed);
		} else {
			_addToConfigPool(data);
		}
	}

	// ---------- Private functions ----------

	function _addToConfigPool(VRFCoinFlipData storage _data) private {
		CoinFlipConfig storage config = coinFlipConfigs[_data.configId];

		config.supply += 2;

		if (coinFlipConfigs[_data.configId].tokenType == 721) {
			tokenOfConfigByIndex[_data.configId][config.supply - 1] = _data.nftId;
		}
	}

	function _giveAsset(
		VRFCoinFlipData storage _data,
		uint256 _randomSeed
	) private {
		CoinFlipConfig storage config = coinFlipConfigs[_data.configId];
		uint256 configType = config.tokenType;

		if (configType == 1) {
			payable(_data.player).transfer(config.tokenAmount * 2);
		} else if (configType == 20) {
			IERC20(config.tokenAddress).transferFrom(
				address(this),
				_data.player,
				config.tokenAmount * 2
			);
		} else if (configType == 1155) {
			IERC1155(config.tokenAddress).safeTransferFrom(
				address(this),
				_data.player,
				config.tokenId,
				config.tokenAmount * 2,
				""
			);
		} else if (configType == 721) {
			uint256 randomIndex = _randomSeed % (config.supply + 1); // +1 because supply is -1 compared to real supply until we transfer reward
			uint256 randomNftId = tokenOfConfigByIndex[_data.configId][randomIndex];

			IERC721(config.tokenAddress).safeTransferFrom(
				address(this),
				_data.player,
				_data.nftId
			);

			IERC721(config.tokenAddress).safeTransferFrom(
				address(this),
				_data.player,
				randomNftId
			);
		}
	}

	function _takeAsset(CoinFlipConfig storage _config, uint256 _nftId) private {
		uint256 configType = _config.tokenType;

		if (configType == 1) {
			require(msg.value == _config.tokenAmount);
		} else if (configType == 20) {
			IERC20(_config.tokenAddress).transferFrom(
				msg.sender,
				address(this),
				_config.tokenAmount
			);
		} else if (configType == 1155) {
			IERC1155(_config.tokenAddress).safeTransferFrom(
				msg.sender,
				address(this),
				_config.tokenId,
				_config.tokenAmount,
				""
			);
		} else if (configType == 721) {
			IERC721(_config.tokenAddress).safeTransferFrom(
				msg.sender,
				address(this),
				_nftId
			);
		}
	}

	receive() external payable {}
}