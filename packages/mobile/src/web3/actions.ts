import { getPincode } from 'src/account/actions'
import CeloAnalytics from 'src/analytics/CeloAnalytics'
import { DefaultEventNames } from 'src/analytics/constants'
import { isGethFreeMode, UNLOCK_DURATION } from 'src/geth/consts'
import Logger from 'src/utils/Logger'
import { addLocalAccount, getWeb3 } from 'src/web3/contracts'
import { readPrivateKeyFromLocalDisk } from 'src/web3/saga'
import * as util from 'util'

const TAG = 'web3/actions'

export enum Actions {
  SET_ACCOUNT = 'WEB3/SET_ACCOUNT',
  SET_COMMENT_KEY = 'WEB3/SET_COMMENT_KEY',
  SET_PROGRESS = 'WEB3/SET_PROGRESS',
  SET_IS_READY = 'WEB3/SET_IS_READY',
  SET_BLOCK_NUMBER = 'WEB3/SET_BLOCK_NUMBER',
  REQUEST_SYNC_PROGRESS = 'WEB3/REQUEST_SYNC_PROGRESS',
  UPDATE_WEB3_SYNC_PROGRESS = 'WEB3/UPDATE_WEB3_SYNC_PROGRESS',
}

export interface SetAccountAction {
  type: Actions.SET_ACCOUNT
  address: string
}

export interface SetCommentKeyAction {
  type: Actions.SET_COMMENT_KEY
  commentKey: string
}

export interface SetLatestBlockNumberAction {
  type: Actions.SET_BLOCK_NUMBER
  latestBlockNumber: number
}

export interface UpdateWeb3SyncProgressAction {
  type: Actions.UPDATE_WEB3_SYNC_PROGRESS
  payload: {
    startingBlock: number
    currentBlock: number
    highestBlock: number
  }
}

export type ActionTypes =
  | SetAccountAction
  | SetCommentKeyAction
  | SetLatestBlockNumberAction
  | UpdateWeb3SyncProgressAction

export const setAccount = (address: string): SetAccountAction => {
  CeloAnalytics.track(DefaultEventNames.accountSet, { address })
  return {
    type: Actions.SET_ACCOUNT,
    address,
  }
}

export const setPrivateCommentKey = (commentKey: string): SetCommentKeyAction => {
  return {
    type: Actions.SET_COMMENT_KEY,
    commentKey,
  }
}

export const setLatestBlockNumber = (latestBlockNumber: number): SetLatestBlockNumberAction => ({
  type: Actions.SET_BLOCK_NUMBER,
  latestBlockNumber,
})

// TODO: Remove duplicaiton with SetProgress action (this is currently unused)
export const updateWeb3SyncProgress = (payload: {
  startingBlock: number
  currentBlock: number
  highestBlock: number
}): UpdateWeb3SyncProgressAction => ({
  type: Actions.UPDATE_WEB3_SYNC_PROGRESS,
  payload,
})

async function isLocked(address: any) {
  const web3 = await getWeb3()
  try {
    // Test account to see if it is unlocked
    await web3.eth.sign('', address)
  } catch (e) {
    return true
  }
  return false
}

export const unlockAccount = async (account: string) => {
  const isAccountLocked = await isLocked(account)
  if (isAccountLocked) {
    const password = await getPincode()
    return performUnlock(account, password, UNLOCK_DURATION)
  } else {
    return true
  }
}

async function performUnlock(
  account: string,
  password: string,
  unlockDuration: number
): Promise<boolean> {
  const web3 = await getWeb3()
  if (isGethFreeMode()) {
    Logger.info(TAG + '@unlockAccount', `unlockDuration is ignored in Geth free mode`)
    const privateKey: string = await readPrivateKeyFromLocalDisk(account, password)
    addLocalAccount(web3, privateKey)
    return true
  } else {
    return (
      web3.eth.personal
        .unlockAccount(account, password, unlockDuration)
        // @ts-ignore
        .catch((error: Error) => {
          Logger.error(
            TAG + '@unlockAccount',
            'Web3 account unlock failed with' + util.inspect(error)
          )
          return false
        })
    )
  }
}

export const checkSyncProgress = () => ({ type: Actions.REQUEST_SYNC_PROGRESS })

export async function getLatestBlock() {
  Logger.debug(TAG, 'Getting latest block')
  const web3 = await getWeb3()
  return web3.eth.getBlock('latest')
}

export async function getBlock(blockNumber: number) {
  Logger.debug(TAG, 'Getting block ' + blockNumber)
  const web3 = await getWeb3()
  return web3.eth.getBlock(blockNumber)
}
