pragma solidity ^0.5.3;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "../common/FixidityLib.sol";
import "../common/Initializable.sol";
import "../common/UsingRegistry.sol";
import "../common/UsingPrecompiles.sol";

/**
 * @title Contract for calculating epoch rewards.
 */
contract EpochRewards is Ownable, Initializable, UsingPrecompiles, UsingRegistry {

  using FixidityLib for FixidityLib.Fraction;
  using SafeMath for uint256;

  uint256 constant GENESIS_GOLD_SUPPLY = 600000000000000000000000000;
  uint256 constant GOLD_SUPPLY_CAP = 1000000000000000000000000000;
  uint256 constant YEARS_LINEAR = 15;
  uint256 constant SECONDS_LINEAR = YEARS_LINEAR * 365 * 1 days;
  uint256 constant FIXIDITY_E = 2718281828459045235360287;
  uint256 constant FIXIDITY_LN2 = 693147180559945309417232;

  struct RewardsMultiplierAdjustmentFactors {
    FixidityLib.Fraction underspend;
    FixidityLib.Fraction overspend;
  }

  struct RewardsMultiplierParameters {
    RewardsMultiplierAdjustmentFactors adjustmentFactors;
    FixidityLib.Fraction max;
  }

  struct TargetVotingYieldParameters {
    FixidityLib.Fraction target;
    FixidityLib.Fraction adjustmentFactor;
    FixidityLib.Fraction max;
  }

  uint256 private startTime = 0;
  RewardsMultiplierParameters private rewardsMultiplierParams;
  TargetVotingYieldParameters private targetVotingYieldParams;
  FixidityLib.Fraction private targetVotingGoldFraction;
  uint256 public maxValidatorEpochPayment;

  event TargetVotingGoldFractionSet(uint256 fraction);
  event MaxValidatorEpochPaymentSet(uint256 payment);
  event TargetVotingYieldParametersSet(uint256 max, uint256 adjustmentFactor);
  event RewardsMultiplierParametersSet(
    uint256 max,
    uint256 underspendAdjustmentFactor,
    uint256 overspendAdjustmentFactor
  );

  function initialize(
    address registryAddress,
    uint256 targetVotingYieldInitial,
    uint256 targetVotingYieldMax,
    uint256 targetVotingYieldAdjustmentFactor,
    uint256 rewardsMultiplierMax,
    uint256 rewardsMultiplierUnderspendAdjustmentFactor,
    uint256 rewardsMultiplierOverspendAdjustmentFactor,
    uint256 _targetVotingGoldFraction,
    uint256 _maxValidatorEpochPayment
  )
    external
    initializer
  {
    _transferOwnership(msg.sender);
    setRegistry(registryAddress);
    setTargetVotingYieldParameters(targetVotingYieldMax, targetVotingYieldAdjustmentFactor);
    setRewardsMultiplierParameters(
      rewardsMultiplierMax,
      rewardsMultiplierUnderspendAdjustmentFactor,
      rewardsMultiplierOverspendAdjustmentFactor
    );
    setTargetVotingGoldFraction(_targetVotingGoldFraction);
    setMaxValidatorEpochPayment(_maxValidatorEpochPayment);
    targetVotingYieldParams.target = FixidityLib.wrap(targetVotingYieldInitial);
    startTime = now;
  }

  function getTargetVotingYieldParameters() external view returns (uint256, uint256, uint256) {
    TargetVotingYieldParameters storage params = targetVotingYieldParams;
    return (params.target.unwrap(), params.max.unwrap(), params.adjustmentFactor.unwrap());
  }

  function getRewardsMultiplierParameters() external view returns (uint256, uint256, uint256) {
    RewardsMultiplierParameters storage params = rewardsMultiplierParams;
    return (
      params.max.unwrap(),
      params.adjustmentFactors.underspend.unwrap(),
      params.adjustmentFactors.overspend.unwrap()
    );
  }

  function setTargetVotingGoldFraction(uint256 value) public onlyOwner returns (bool) {
    require(value != targetVotingGoldFraction.unwrap() && value < FixidityLib.fixed1().unwrap());
    targetVotingGoldFraction = FixidityLib.wrap(value);
    emit TargetVotingGoldFractionSet(value);
    return true;
  }

  function getTargetVotingGoldFraction() external view returns (uint256) {
    return targetVotingGoldFraction.unwrap();
  }

  /**
   * @notice Sets the max per-epoch payment in Celo Dollars for validators.
   * @param value The value in Celo Dollars.
   * @return True upon success.
   */
  function setMaxValidatorEpochPayment(uint256 value) public onlyOwner returns (bool) {
    require(value != maxValidatorEpochPayment);
    maxValidatorEpochPayment = value;
    emit MaxValidatorEpochPaymentSet(value);
    return true;
  }

  function setRewardsMultiplierParameters(
    uint256 max,
    uint256 underspendAdjustmentFactor,
    uint256 overspendAdjustmentFactor
  )
    public
    onlyOwner
    returns (bool)
  {
    require(
      max != rewardsMultiplierParams.max.unwrap() ||
      overspendAdjustmentFactor != rewardsMultiplierParams.adjustmentFactors.overspend.unwrap() ||
      underspendAdjustmentFactor != rewardsMultiplierParams.adjustmentFactors.underspend.unwrap()
    );
    rewardsMultiplierParams = RewardsMultiplierParameters(
      RewardsMultiplierAdjustmentFactors(
        FixidityLib.wrap(underspendAdjustmentFactor),
        FixidityLib.wrap(overspendAdjustmentFactor)
      ),
      FixidityLib.wrap(max)
    );
    emit RewardsMultiplierParametersSet(
      max,
      underspendAdjustmentFactor,
      overspendAdjustmentFactor
    );
    return true;
  }

  function setTargetVotingYieldParameters(
    uint256 max,
    uint256 adjustmentFactor
  )
    public
    onlyOwner
    returns (bool)
  {
    require(
      max != targetVotingYieldParams.max.unwrap() ||
      adjustmentFactor != targetVotingYieldParams.adjustmentFactor.unwrap()
    );
    targetVotingYieldParams.max = FixidityLib.wrap(max);
    targetVotingYieldParams.adjustmentFactor = FixidityLib.wrap(adjustmentFactor);
    require(
      targetVotingYieldParams.max.lt(FixidityLib.fixed1()),
      "Max target voting yield must be lower than 100%"
    );
    emit TargetVotingYieldParametersSet(max, adjustmentFactor);
    return true;
  }

  function getTargetGoldTotalSupply() public view returns (uint256) {
    uint256 timeSinceInitialization = now.sub(startTime);
    if (timeSinceInitialization < SECONDS_LINEAR) {
      // Pay out half of all block rewards linearly.
      uint256 linearRewards = GOLD_SUPPLY_CAP.sub(GENESIS_GOLD_SUPPLY).div(2);
      uint256 targetRewards = linearRewards.mul(timeSinceInitialization).div(SECONDS_LINEAR);
      return targetRewards.add(GENESIS_GOLD_SUPPLY);
    } else {
      // TODO(asa): Implement block reward calculation for years 15-30.
      return 0;
    }
  }

  function _getRewardsMultiplier(
    uint256 targetGoldSupplyIncrease
  )
    internal
    view
    returns (FixidityLib.Fraction memory)
  {
    uint256 targetSupply = getTargetGoldTotalSupply();
    uint256 totalSupply = getGoldToken().totalSupply();
    uint256 remainingSupply = GOLD_SUPPLY_CAP.sub(totalSupply.add(targetGoldSupplyIncrease));
    uint256 targetRemainingSupply = GOLD_SUPPLY_CAP.sub(targetSupply);
    FixidityLib.Fraction memory ratio = FixidityLib.newFixed(remainingSupply).divide(
      FixidityLib.newFixed(targetRemainingSupply)
    );
    if (ratio.gt(FixidityLib.fixed1())) {
      FixidityLib.Fraction memory delta = ratio.subtract(FixidityLib.fixed1()).multiply(
        rewardsMultiplierParams.adjustmentFactors.underspend
      );
      FixidityLib.Fraction memory r = FixidityLib.fixed1().add(delta);
      if (r.lt(rewardsMultiplierParams.max)) {
        return r;
      } else {
        return rewardsMultiplierParams.max;
      }
    } else if (ratio.lt(FixidityLib.fixed1())) {
      FixidityLib.Fraction memory delta = FixidityLib.fixed1().subtract(ratio).multiply(
        rewardsMultiplierParams.adjustmentFactors.overspend
      );
      if (delta.lt(FixidityLib.fixed1())) {
        return FixidityLib.fixed1().subtract(delta);
      } else {
        return FixidityLib.wrap(0);
      }
    } else {
      return FixidityLib.fixed1();
    }
  }

  function getRewardsMultiplier() external view returns (uint256) {
    uint256 targetEpochRewards = getTargetEpochRewards();
    uint256 targetTotalEpochPaymentsInGold = getTargetTotalEpochPaymentsInGold();
    uint256 targetGoldSupplyIncrease = targetEpochRewards.add(targetTotalEpochPaymentsInGold);
    return _getRewardsMultiplier(targetGoldSupplyIncrease).unwrap();
  }

  function getTargetEpochRewards() public view returns (uint256) {
    return FixidityLib.newFixed(getElection().getActiveVotes()).multiply(
      targetVotingYieldParams.target
    ).fromFixed();
  }

  function getTargetTotalEpochPaymentsInGold() public view returns (uint256) {
    address stableTokenAddress = registry.getAddressForOrDie(STABLE_TOKEN_REGISTRY_ID);
    (uint256 numerator, uint256 denominator) = getSortedOracles().medianRate(stableTokenAddress);
    return numberValidatorsInCurrentSet().mul(maxValidatorEpochPayment).mul(denominator).div(
      numerator
    );
  }

  function getVotingGoldFraction() public view returns (uint256) {
    // TODO(asa): Ignore custodial accounts.
    address reserveAddress = registry.getAddressForOrDie(RESERVE_REGISTRY_ID);
    uint256 liquidGold = getGoldToken().totalSupply().sub(reserveAddress.balance);
    // TODO(asa): Should this be active votes?
    uint256 votingGold = getElection().getTotalVotes();
    return FixidityLib.newFixed(votingGold).divide(FixidityLib.newFixed(liquidGold)).unwrap();
  }

  function _updateTargetVotingYield() internal {
    FixidityLib.Fraction memory votingGoldFraction = FixidityLib.wrap(getVotingGoldFraction());
    if (votingGoldFraction.gt(targetVotingGoldFraction)) {
      FixidityLib.Fraction memory votingGoldFractionDelta = votingGoldFraction.subtract(
        targetVotingGoldFraction
      );
      FixidityLib.Fraction memory targetVotingYieldDelta = votingGoldFractionDelta.multiply(
        targetVotingYieldParams.adjustmentFactor
      );
      if (targetVotingYieldDelta.gte(targetVotingYieldParams.target)) {
        targetVotingYieldParams.target = FixidityLib.newFixed(0);
      } else {
        targetVotingYieldParams.target = targetVotingYieldParams.target.subtract(
          targetVotingYieldDelta
        );
      }
    } else if (votingGoldFraction.lt(targetVotingGoldFraction)) {
      FixidityLib.Fraction memory votingGoldFractionDelta = targetVotingGoldFraction.subtract(
        votingGoldFraction
      );
      FixidityLib.Fraction memory targetVotingYieldDelta = votingGoldFractionDelta.multiply(
        targetVotingYieldParams.adjustmentFactor
      );
      targetVotingYieldParams.target = targetVotingYieldParams.target.add(targetVotingYieldDelta);
      if (targetVotingYieldParams.target.gt(targetVotingYieldParams.max)) {
        targetVotingYieldParams.target = targetVotingYieldParams.max;
      }
    }
  }

  function updateTargetVotingYield() external {
    require(msg.sender == address(0));
    _updateTargetVotingYield();
  }

  function calculateTargetEpochPaymentAndRewards() external view returns (uint256, uint256) {
    uint256 targetEpochRewards = getTargetEpochRewards();
    uint256 targetTotalEpochPaymentsInGold = getTargetTotalEpochPaymentsInGold();
    uint256 targetGoldSupplyIncrease = targetEpochRewards.add(targetTotalEpochPaymentsInGold);
    FixidityLib.Fraction memory rewardsMultiplier = _getRewardsMultiplier(
      targetGoldSupplyIncrease
    );
    return (
      FixidityLib.newFixed(maxValidatorEpochPayment).multiply(rewardsMultiplier).fromFixed(),
      FixidityLib.newFixed(targetEpochRewards).multiply(rewardsMultiplier).fromFixed()
    );
  }
}
