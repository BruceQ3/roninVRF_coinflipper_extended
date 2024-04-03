// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IRoninVRFCoordinatorForConsumers.sol";

abstract contract VRFConsumer {
  error OnlyCoordinatorCanFulfill();
  address public vrfCoordinator;

  /**
   * @dev Raw fulfills random seed.
   *
   * Requirements:
   * - The method caller is VRF coordinator `vrfCoordinator`.
   *
   * @notice The function `rawFulfillRandomSeed` is called by VRFCoordinator when it receives a valid VRF
   * proof. It then calls `_fulfillRandomSeed`, after validating the origin of the call.
   *
   */
  function rawFulfillRandomSeed(bytes32 _reqHash, uint256 _randomSeed) external {
    if (msg.sender != vrfCoordinator) revert OnlyCoordinatorCanFulfill();
    _fulfillRandomSeed(_reqHash, _randomSeed);
  }

  /**
   * @dev Fulfills random seed `_randomSeed` based on the request hash `_reqHash`
   */
  function _fulfillRandomSeed(bytes32 _reqHash, uint256 _randomSeed) internal virtual;

  /**
   * @dev Request random seed to the coordinator contract. Returns the request hash.
   *  Consider using the method `IRoninVRFCoordinatorForConsumers.estimateRequestRandomFee` to estimate the random fee.
   *
   * @param _value Amount of RON to cover gas fee for oracle, will be refunded to `_refundAddr`.
   * @param _callbackGasLimit The callback gas amount, which should cover enough gas used for the method `_fulfillRandomSeed`.
   * @param _gasPriceToFulFill The gas price that orale must send transaction to fulfill.
   * @param _refundAddr Refund address if there is RON left after paying gas fee to oracle.
   */
  function _requestRandomness(
    uint256 _value,
    uint256 _callbackGasLimit,
    uint256 _gasPriceToFulFill,
    address _refundAddr
  ) internal virtual returns (bytes32 _reqHash) {
    return
      IRoninVRFCoordinatorForConsumers(vrfCoordinator).requestRandomSeed{ value: _value }(
      _callbackGasLimit,
      _gasPriceToFulFill,
      address(this),
      _refundAddr
    );
  }
}