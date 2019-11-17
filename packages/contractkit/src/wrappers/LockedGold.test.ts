import { newKitFromWeb3 } from '../kit'
import { testWithGanache } from '../test-utils/ganache-test'
import { AccountsWrapper } from './Accounts'
import { LockedGoldWrapper } from './LockedGold'

testWithGanache('Validators Wrapper', (web3) => {
  const kit = newKitFromWeb3(web3)
  let accounts: AccountsWrapper
  let lockedGold: LockedGoldWrapper

  // Arbitrary value.
  const value = 120938732980
  let account: string
  beforeAll(async () => {
    account = (await web3.eth.getAccounts())[0]
    lockedGold = await kit.contracts.getLockedGold()
    accounts = await kit.contracts.getAccounts()
    await accounts.createAccount().sendAndWaitForReceipt({ from: account })
  })

  test('SBAT lock gold', async () => {
    await lockedGold.lock().sendAndWaitForReceipt({ from: account, value })
  })

  test('SBAT unlock gold', async () => {
    await lockedGold.lock().sendAndWaitForReceipt({ from: account, value })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
  })

  test('SBAT relock gold', async () => {
    // Make 5 pending withdrawals.
    await lockedGold.lock().sendAndWaitForReceipt({ from: account, value: value * 5 })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
    await lockedGold.unlock(value).sendAndWaitForReceipt({ from: account })
    // Re-lock 2.5 of them
    const txos = await lockedGold.relock(account, value * 2.5)
    await Promise.all(txos.map((txo) => txo.sendAndWaitForReceipt({ from: account })))
    //
  })
})