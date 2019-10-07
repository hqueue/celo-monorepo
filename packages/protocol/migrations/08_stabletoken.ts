/* tslint:disable:no-console */
import Web3 = require('web3')

import { CeloContractName } from '@celo/protocol/lib/registry-utils'
import {
  convertToContractDecimalsBN,
  deploymentForCoreContract,
  getDeployedProxiedContract,
} from '@celo/protocol/lib/web3-utils'
import { config } from '@celo/protocol/migrationsConfig'
import { toFixed } from '@celo/utils/lib/fixidity'
import {
  GasCurrencyWhitelistInstance,
  ReserveInstance,
  SortedOraclesInstance,
  StableTokenInstance,
} from 'types'

const truffle = require('@celo/protocol/truffle-config.js')
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000'

const initializeArgs = async (): Promise<any[]> => {
  const rate = toFixed(config.stableToken.inflationRate)

  return [
    config.stableToken.tokenName,
    config.stableToken.tokenSymbol,
    config.stableToken.decimals,
    config.registry.predeployedProxyAddress,
    rate.toString(),
    config.stableToken.inflationPeriod,
  ]
}

module.exports = deploymentForCoreContract<StableTokenInstance>(
  web3,
  artifacts,
  CeloContractName.StableToken,
  initializeArgs,
  async (stableToken: StableTokenInstance, _web3: Web3, networkName: string) => {
    const minerAddress: string = truffle.networks[networkName].from
    const minerStartBalance = await convertToContractDecimalsBN(
      config.stableToken.minerDollarBalance.toString(),
      stableToken
    )
    console.log(
      `Minting ${minerAddress} ${config.stableToken.minerDollarBalance.toString()} StableToken`
    )
    await stableToken.setMinter(minerAddress)

    const initialBalance = web3.utils.toBN(minerStartBalance)
    await stableToken.mint(minerAddress, initialBalance)
    for (const address of config.stableToken.initialAccounts) {
      await stableToken.mint(address, initialBalance)
    }

    console.log('Setting GoldToken/USD exchange rate')
    const sortedOracles: SortedOraclesInstance = await getDeployedProxiedContract<
      SortedOraclesInstance
    >('SortedOracles', artifacts)

    console.log(config.stableToken)
    // console.log(`adding first one ${config.stableToken.priceOracleAccounts}`)
    // await sortedOracles.addOracle(stableToken.address, config.stableToken.priceOracleAccounts[0])
    // console.log('adding second one')
    // await sortedOracles.addOracle(stableToken.address, '5409ED021D9299bf6814279A6A1411A7e866A631')
    console.log(`adding third one: ${minerAddress}`)
    await sortedOracles.addOracle(stableToken.address, minerAddress)
    await sortedOracles.addOracle(stableToken.address, '0xE834EC434DABA538cd1b9Fe1582052B880BD7e63')
    console.log(`reporting initial: ${config.stableToken.goldPrice}`)
    await sortedOracles.report(
      stableToken.address,
      config.stableToken.goldPrice,
      1,
      NULL_ADDRESS,
      NULL_ADDRESS
    )
    console.log(await sortedOracles.getRates(stableToken.address))

    const reserve: ReserveInstance = await getDeployedProxiedContract<ReserveInstance>(
      'Reserve',
      artifacts
    )
    console.log('Adding StableToken to Reserve')
    await reserve.addToken(stableToken.address)

    console.log('Whitelisting StableToken as a gas currency')
    const gasCurrencyWhitelist: GasCurrencyWhitelistInstance = await getDeployedProxiedContract<
      GasCurrencyWhitelistInstance
    >('GasCurrencyWhitelist', artifacts)
    await gasCurrencyWhitelist.addToken(stableToken.address)
  }
)
