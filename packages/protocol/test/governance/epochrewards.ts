import { CeloContractName } from '@celo/protocol/lib/registry-utils'
import {
  assertContainSubset,
  assertEqualBN,
  assertRevert,
  timeTravel,
} from '@celo/protocol/lib/test-utils'
import BigNumber from 'bignumber.js'
import {
  MockElectionContract,
  MockElectionInstance,
  MockGoldTokenContract,
  MockGoldTokenInstance,
  MockSortedOraclesContract,
  MockSortedOraclesInstance,
  EpochRewardsTestContract,
  EpochRewardsTestInstance,
  RegistryContract,
  RegistryInstance,
} from 'types'
import { fromFixed, toFixed } from '@celo/utils/lib/fixidity'

const EpochRewards: EpochRewardsTestContract = artifacts.require('EpochRewardsTest')
const MockElection: MockElectionContract = artifacts.require('MockElection')
const MockGoldToken: MockGoldTokenContract = artifacts.require('MockGoldToken')
const MockSortedOracles: MockSortedOraclesContract = artifacts.require('MockSortedOracles')
const Registry: RegistryContract = artifacts.require('Registry')

// @ts-ignore
// TODO(mcortesi): Use BN
EpochRewards.numberFormat = 'BigNumber'

const YEAR = new BigNumber(365 * 24 * 60 * 60)
const SUPPLY_CAP = new BigNumber(web3.utils.toWei('1000000000'))

const getExpectedTargetTotalSupply = (timeDelta: BigNumber) => {
  const genesisSupply = new BigNumber(web3.utils.toWei('600000000'))
  const linearRewards = new BigNumber(web3.utils.toWei('200000000'))
  return genesisSupply
    .plus(timeDelta.times(linearRewards).div(YEAR.times(15)))
    .integerValue(BigNumber.ROUND_FLOOR)
}

contract('EpochRewards', (accounts: string[]) => {
  let epochRewards: EpochRewardsTestInstance
  let mockElection: MockElectionInstance
  let mockGoldToken: MockGoldTokenInstance
  let mockSortedOracles: MockSortedOraclesInstance
  let registry: RegistryInstance
  const nonOwner = accounts[1]

  const targetVotingYieldParams = {
    initial: toFixed(new BigNumber(1 / 20)),
    max: toFixed(new BigNumber(1 / 5)),
    adjustmentFactor: toFixed(new BigNumber(1 / 365)),
  }
  const rewardsMultiplier = {
    max: toFixed(new BigNumber(2)),
    adjustments: {
      underspend: toFixed(new BigNumber(1 / 2)),
      overspend: toFixed(new BigNumber(5)),
    },
  }
  const targetVotingGoldFraction = toFixed(new BigNumber(2 / 3))
  const maxValidatorEpochPayment = new BigNumber(10000000000000)
  beforeEach(async () => {
    epochRewards = await EpochRewards.new()
    mockElection = await MockElection.new()
    mockGoldToken = await MockGoldToken.new()
    mockSortedOracles = await MockSortedOracles.new()
    registry = await Registry.new()
    await registry.setAddressFor(CeloContractName.Election, mockElection.address)
    await registry.setAddressFor(CeloContractName.GoldToken, mockGoldToken.address)
    await registry.setAddressFor(CeloContractName.SortedOracles, mockSortedOracles.address)
    await epochRewards.initialize(
      registry.address,
      targetVotingYieldParams.initial,
      targetVotingYieldParams.max,
      targetVotingYieldParams.adjustmentFactor,
      rewardsMultiplier.max,
      rewardsMultiplier.adjustments.underspend,
      rewardsMultiplier.adjustments.overspend,
      targetVotingGoldFraction,
      maxValidatorEpochPayment
    )
  })

  describe('#initialize()', () => {
    it('should have set the owner', async () => {
      const owner: string = await epochRewards.owner()
      assert.equal(owner, accounts[0])
    })

    it('should have set the max validator epoch payment', async () => {
      assertEqualBN(await epochRewards.maxValidatorEpochPayment(), maxValidatorEpochPayment)
    })

    it('should have set the target voting yield parameters', async () => {
      const [target, max, adjustmentFactor] = await epochRewards.getTargetVotingYieldParameters()
      assertEqualBN(target, targetVotingYieldParams.initial)
      assertEqualBN(max, targetVotingYieldParams.max)
      assertEqualBN(adjustmentFactor, targetVotingYieldParams.adjustmentFactor)
    })

    it('should have set the rewards multiplier adjustment factors', async () => {
      const [underspend, overspend] = await epochRewards.getRewardsMultiplierAdjustmentFactors()
      assertEqualBN(underspend, rewardsMultiplierAdjustments.underspend)
      assertEqualBN(overspend, rewardsMultiplierAdjustments.overspend)
    })

    it('should not be callable again', async () => {
      await assertRevert(
        epochRewards.initialize(
          registry.address,
          targetVotingYieldParams.initial,
          targetVotingYieldParams.max,
          targetVotingYieldParams.adjustmentFactor,
          rewardsMultiplier.max,
          rewardsMultiplier.adjustments.underspend,
          rewardsMultiplier.adjustments.overspend,
          targetVotingGoldFraction,
          maxValidatorEpochPayment
        )
      )
    })
  })

  describe('#setTargetVotingGoldFraction()', () => {
    describe('when the fraction is different', () => {
      const newFraction = targetVotingGoldFraction.plus(1)

      describe('when called by the owner', () => {
        let resp: any

        beforeEach(async () => {
          resp = await epochRewards.setTargetVotingGoldFraction(newFraction)
        })

        it('should set the target voting gold fraction', async () => {
          assertEqualBN(await epochRewards.getTargetVotingGoldFraction(), newFraction)
        })

        it('should emit the TargetVotingGoldFractionSet event', async () => {
          assert.equal(resp.logs.length, 1)
          const log = resp.logs[0]
          assertContainSubset(log, {
            event: 'TargetVotingGoldFractionSet',
            args: {
              fraction: newFraction,
            },
          })
        })

        describe('when called by a non-owner', () => {
          it('should revert', async () => {
            await assertRevert(
              epochRewards.setTargetVotingGoldFraction(newFraction, {
                from: nonOwner,
              })
            )
          })
        })
      })

      describe('when the fraction is the same', () => {
        it('should revert', async () => {
          await assertRevert(epochRewards.setTargetVotingGoldFraction(targetVotingGoldFraction))
        })
      })
    })
  })

  describe('#setMaxValidatorEpochPayment()', () => {
    describe('when the payment is different', () => {
      const newPayment = maxValidatorEpochPayment.plus(1)

      describe('when called by the owner', () => {
        let resp: any

        beforeEach(async () => {
          resp = await epochRewards.setMaxValidatorEpochPayment(newPayment)
        })

        it('should set the max validator epoch payment', async () => {
          assertEqualBN(await epochRewards.maxValidatorEpochPayment(), newPayment)
        })

        it('should emit the MaxValidatorEpochPaymentSet event', async () => {
          assert.equal(resp.logs.length, 1)
          const log = resp.logs[0]
          assertContainSubset(log, {
            event: 'MaxValidatorEpochPaymentSet',
            args: {
              payment: newPayment,
            },
          })
        })

        describe('when called by a non-owner', () => {
          it('should revert', async () => {
            await assertRevert(
              epochRewards.setMaxValidatorEpochPayment(newPayment, {
                from: nonOwner,
              })
            )
          })
        })
      })

      describe('when the payment is the same', () => {
        it('should revert', async () => {
          await assertRevert(epochRewards.setMaxValidatorEpochPayment(maxValidatorEpochPayment))
        })
      })
    })
  })

  describe('#setRewardsMultiplierAdjustmentFactors()', () => {
    describe('when one of the factors is different', () => {
      const newFactors = {
        underspend: rewardsMultiplierAdjustments.underspend.plus(1),
        overspend: rewardsMultiplierAdjustments.overspend,
      }

      describe('when called by the owner', () => {
        let resp: any

        beforeEach(async () => {
          resp = await epochRewards.setRewardsMultiplierAdjustmentFactors(
            newFactors.underspend,
            newFactors.overspend
          )
        })

        it('should set the new rewards multiplier adjustment factors', async () => {
          const [underspend, overspend] = await epochRewards.getRewardsMultiplierAdjustmentFactors()
          assertEqualBN(underspend, newFactors.underspend)
          assertEqualBN(overspend, newFactors.overspend)
        })

        it('should emit the RewardsMultiplierAdjustmentFactorsSet event', async () => {
          assert.equal(resp.logs.length, 1)
          const log = resp.logs[0]
          assertContainSubset(log, {
            event: 'RewardsMultiplierAdjustmentFactorsSet',
            args: {
              underspend: newFactors.underspend,
              overspend: newFactors.overspend,
            },
          })
        })

        describe('when called by a non-owner', () => {
          it('should revert', async () => {
            await assertRevert(
              epochRewards.setRewardsMultiplierAdjustmentFactors(
                newFactors.underspend,
                newFactors.overspend,
                {
                  from: nonOwner,
                }
              )
            )
          })
        })
      })

      describe('when the parameters are the same', () => {
        it('should revert', async () => {
          await assertRevert(
            epochRewards.setRewardsMultiplierAdjustmentFactors(
              rewardsMultiplierAdjustments.underspend,
              rewardsMultiplierAdjustments.overspend
            )
          )
        })
      })
    })
  })

  describe('#setTargetVotingYieldParameters()', () => {
    describe('when the parameters are different', () => {
      const newMax = targetVotingYieldParams.max.plus(1)
      const newFactor = targetVotingYieldParams.adjustmentFactor.plus(1)

      describe('when called by the owner', () => {
        let resp: any

        beforeEach(async () => {
          resp = await epochRewards.setTargetVotingYieldParameters(newMax, newFactor)
        })

        it('should set the new target voting yield parameters', async () => {
          const [, max, adjustmentFactor] = await epochRewards.getTargetVotingYieldParameters()
          assertEqualBN(max, newMax)
          assertEqualBN(adjustmentFactor, newFactor)
        })

        it('should emit the TargetVotingYieldParametersSet event', async () => {
          assert.equal(resp.logs.length, 1)
          const log = resp.logs[0]
          assertContainSubset(log, {
            event: 'TargetVotingYieldParametersSet',
            args: {
              max: newMax,
              adjustmentFactor: newFactor,
            },
          })
        })

        describe('when called by a non-owner', () => {
          it('should revert', async () => {
            await assertRevert(
              epochRewards.setTargetVotingYieldParameters(newMax, newFactor, {
                from: nonOwner,
              })
            )
          })
        })
      })

      describe('when the parameters are the same', () => {
        it('should revert', async () => {
          await assertRevert(
            epochRewards.setTargetVotingYieldParameters(
              targetVotingYieldParams.max,
              targetVotingYieldParams.adjustmentFactor
            )
          )
        })
      })
    })
  })

  describe('#getTargetGoldTotalSupply()', () => {
    describe('when it has been fewer than 15 years since genesis', () => {
      const timeDelta = YEAR.times(10)
      beforeEach(async () => {
        await timeTravel(timeDelta.toNumber(), web3)
      })

      it('should return 600MM + 200MM * t / 15', async () => {
        assertEqualBN(
          await epochRewards.getTargetGoldTotalSupply(),
          getExpectedTargetTotalSupply(timeDelta)
        )
      })
    })
  })

  describe('#getTargetEpochRewards()', () => {
    describe('when there are active votes', () => {
      const activeVotes = 1000000
      beforeEach(async () => {
        await mockElection.setActiveVotes(activeVotes)
      })

      it('should return a percentage of the active votes', async () => {
        const expected = fromFixed(targetVotingYieldParams.initial).times(activeVotes)
        assertEqualBN(await epochRewards.getTargetEpochRewards(), expected)
      })
    })
  })

  describe.only('#getTargetTotalEpochPaymentsInGold()', () => {
    describe('when a StableToken exchange rate is set', () => {
      // 7 StableToken to one Celo Gold
      const exchangeRate = 7
      const sortedOraclesDenominator = new BigNumber('0x10000000000000000')
      const randomAddress = web3.utils.randomHex(20)
      // Hard coded in EpochRewardsTest.sol
      const numValidators = 100
      beforeEach(async () => {
        await registry.setAddressFor(CeloContractName.StableToken, randomAddress)
        await mockSortedOracles.setMedianRate(
          randomAddress,
          sortedOraclesDenominator.times(exchangeRate)
        )
      })

      it('should return the number of validators times the max payment divided by the exchange rate', async () => {
        const expected = maxValidatorEpochPayment
          .times(numValidators)
          .div(exchangeRate)
          .integerValue(BigNumber.ROUND_FLOOR)
        assertEqualBN(await epochRewards.getTargetTotalEpochPaymentsInGold(), expected)
      })
    })
  })

  describe.only('#getRewardsMultiplier()', () => {
    const timeDelta = YEAR.times(10)
    const expectedTargetTotalSupply = getExpectedTargetTotalSupply(timeDelta)
    const expectedTargetRemainingSupply = SUPPLY_CAP.minus(expectedTargetTotalSupply)
    const targetEpochReward = new BigNumber(120397694238746)
    beforeEach(async () => {
      await timeTravel(timeDelta.toNumber(), web3)
    })

    describe('when the target supply is equal to the actual supply after rewards', () => {
      beforeEach(async () => {
        await mockGoldToken.setTotalSupply(expectedTargetTotalSupply.minus(targetEpochReward))
      })

      it('should return one', async () => {
        assertEqualBN(await epochRewards.getRewardsMultiplier(targetEpochReward), toFixed(1))
      })
    })

    describe('when the actual remaining supply is 10% more than the target remaining supply after rewards', () => {
      beforeEach(async () => {
        const actualRemainingSupply = expectedTargetRemainingSupply.times(1.1)
        const totalSupply = SUPPLY_CAP.minus(actualRemainingSupply)
          .minus(targetEpochReward)
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockGoldToken.setTotalSupply(totalSupply)
      })

      it('should return one plus 10% times the underspend adjustment', async () => {
        const actual = fromFixed(await epochRewards.getRewardsMultiplier(targetEpochReward))
        const expected = new BigNumber(1).plus(
          fromFixed(rewardsMultiplierAdjustments.underspend).times(0.1)
        )
        // Assert equal to 9 decimal places due to fixidity imprecision.
        assert.equal(expected.dp(9).toFixed(), actual.dp(9).toFixed())
      })
    })

    describe('when the actual remaining supply is 10% less than the target remaining supply after rewards', () => {
      beforeEach(async () => {
        const actualRemainingSupply = expectedTargetRemainingSupply.times(0.9)
        const totalSupply = SUPPLY_CAP.minus(actualRemainingSupply)
          .minus(targetEpochReward)
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockGoldToken.setTotalSupply(totalSupply)
      })

      it('should return one minus 10% times the underspend adjustment', async () => {
        const actual = fromFixed(await epochRewards.getRewardsMultiplier(targetEpochReward))
        const expected = new BigNumber(1).minus(
          fromFixed(rewardsMultiplierAdjustments.overspend).times(0.1)
        )
        // Assert equal to 9 decimal places due to fixidity imprecision.
        assert.equal(expected.dp(9).toFixed(), actual.dp(9).toFixed())
      })
    })
  })

  describe.only('#updateTargetVotingYield()', () => {
    const randomAddress = web3.utils.randomHex(20)
    // Arbitrary numbers
    const totalSupply = new BigNumber(129762987346298761037469283746)
    const reserveBalance = new BigNumber(2397846127684712867321)
    const floatingSupply = totalSupply.minus(reserveBalance)
    beforeEach(async () => {
      await mockGoldToken.setTotalSupply(totalSupply)
      await web3.eth.sendTransaction({
        from: accounts[9],
        to: randomAddress,
        value: reserveBalance.toString(),
      })
      await registry.setAddressFor(CeloContractName.Reserve, randomAddress)
    })

    describe('when the percentage of voting gold is equal to the target', () => {
      beforeEach(async () => {
        const totalVotes = floatingSupply
          .times(fromFixed(targetVotingGoldFraction))
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockElection.setTotalVotes(totalVotes)
        await epochRewards.updateTargetVotingYield()
      })

      it('should not change the target voting yield', async () => {
        assertEqualBN(
          (await epochRewards.getTargetVotingYieldParameters())[0],
          targetVotingYieldParams.initial
        )
      })
    })

    describe('when the percentage of voting gold is 10% less than the target', () => {
      beforeEach(async () => {
        const totalVotes = floatingSupply
          .times(fromFixed(targetVotingGoldFraction).minus(0.1))
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockElection.setTotalVotes(totalVotes)
        await epochRewards.updateTargetVotingYield()
      })

      it('should increase the target voting yield by 10% times the adjustment factor', async () => {
        const expected = fromFixed(
          targetVotingYieldParams.initial.plus(targetVotingYieldParams.adjustmentFactor.times(0.1))
        )
        const actual = fromFixed((await epochRewards.getTargetVotingYieldParameters())[0])
        // Assert equal to 9 decimal places due to fixidity imprecision.
        assert.equal(expected.dp(9).toFixed(), actual.dp(9).toFixed())
      })
    })

    describe('when the percentage of voting gold is 10% more than the target', () => {
      beforeEach(async () => {
        const totalVotes = floatingSupply
          .times(fromFixed(targetVotingGoldFraction).plus(0.1))
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockElection.setTotalVotes(totalVotes)
        await epochRewards.updateTargetVotingYield()
      })

      it('should decrease the target voting yield by 10% times the adjustment factor', async () => {
        const expected = fromFixed(
          targetVotingYieldParams.initial.minus(targetVotingYieldParams.adjustmentFactor.times(0.1))
        )
        const actual = fromFixed((await epochRewards.getTargetVotingYieldParameters())[0])
        // Assert equal to 9 decimal places due to fixidity imprecision.
        assert.equal(expected.dp(9).toFixed(), actual.dp(9).toFixed())
      })
    })
  })

  describe.only('#calculateTargetEpochPaymentAndRewards()', () => {
    describe('when there are active votes, a stable token exchange rate is set and the actual remaining supply is 10% more than the target remaining supply after rewards', () => {
      const activeVotes = 1000000
      const sortedOraclesDenominator = new BigNumber('0x10000000000000000')
      const randomAddress = web3.utils.randomHex(20)
      const timeDelta = YEAR.times(10)
      // 7 StableToken to one Celo Gold
      const exchangeRate = 7
      // Hard coded in EpochRewardsTest.sol
      const numValidators = 100
      let expectedMultiplier: BigNumber
      beforeEach(async () => {
        await mockElection.setActiveVotes(activeVotes)
        await registry.setAddressFor(CeloContractName.StableToken, randomAddress)
        await mockSortedOracles.setMedianRate(
          randomAddress,
          sortedOraclesDenominator.times(exchangeRate)
        )
        await timeTravel(timeDelta.toNumber(), web3)
        const expectedTargetTotalEpochPaymentsInGold = maxValidatorEpochPayment
          .times(numValidators)
          .div(exchangeRate)
          .integerValue(BigNumber.ROUND_FLOOR)
        const expectedTargetEpochRewards = fromFixed(targetVotingYieldParams.initial).times(
          activeVotes
        )
        const expectedTargetGoldSupplyIncrease = expectedTargetEpochRewards.plus(
          expectedTargetTotalEpochPaymentsInGold
        )
        const expectedTargetTotalSupply = getExpectedTargetTotalSupply(timeDelta)
        const expectedTargetRemainingSupply = SUPPLY_CAP.minus(expectedTargetTotalSupply)
        const actualRemainingSupply = expectedTargetRemainingSupply.times(1.1)
        const totalSupply = SUPPLY_CAP.minus(actualRemainingSupply)
          .minus(expectedTargetGoldSupplyIncrease)
          .integerValue(BigNumber.ROUND_FLOOR)
        await mockGoldToken.setTotalSupply(totalSupply)
        expectedMultiplier = new BigNumber(1).plus(
          fromFixed(rewardsMultiplierAdjustments.underspend).times(0.1)
        )
      })

      it('should return the max validator epoch payment times the rewards multiplier', async () => {
        const expected = maxValidatorEpochPayment.times(expectedMultiplier)
        assertEqualBN((await epochRewards.calculateTargetEpochPaymentAndRewards())[0], expected)
      })

      it('should return the target yield times the number of active votes times the rewards multiplier', async () => {
        const expected = fromFixed(targetVotingYieldParams.initial)
          .times(activeVotes)
          .times(expectedMultiplier)
        assertEqualBN((await epochRewards.calculateTargetEpochPaymentAndRewards())[1], expected)
      })
    })
  })
})
