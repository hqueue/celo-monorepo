// this is an implementation of a subset of BLS12-377
const keccak256 = require('keccak256')
const BigInteger = require('bigi')
const reverse = require('buffer-reverse')
import * as bls12377js from 'bls12377js'
import { privateKeyToAddress, privateKeyToPublicKey } from './address'

const n = BigInteger.fromHex('12ab655e9a2ca55660b44d1e5c37b00159aa76fed00000010a11800000000001', 16)

const MODULUSMASK = 31

export const blsPrivateKeyToProcessedPrivateKey = (privateKeyHex: string) => {
  for (let i = 0; i < 256; i++) {
    const originalPrivateKeyBytes = Buffer.from(privateKeyHex, 'hex')

    const iBuffer = new Buffer(1)
    iBuffer[0] = i
    const keyBytes = Buffer.concat([
      Buffer.from('ecdsatobls', 'utf8'),
      iBuffer,
      originalPrivateKeyBytes,
    ])
    const privateKeyBLSBytes = keccak256(keyBytes)

    // tslint:disable-next-line:no-bitwise
    privateKeyBLSBytes[0] &= MODULUSMASK

    const privateKeyNum = BigInteger.fromBuffer(privateKeyBLSBytes)
    if (privateKeyNum.compareTo(n) >= 0) {
      continue
    }

    const privateKeyBytes = reverse(privateKeyNum.toBuffer())

    return privateKeyBytes
  }

  throw new Error("couldn't derive BLS key from ECDSA key")
}
export const getPublicKeysData = (privateKeyHex: string) => {
  const address = privateKeyToAddress(privateKeyHex)
  const publicKey = privateKeyToPublicKey(privateKeyHex)
  const blsValidatorPrivateKeyBytes = blsPrivateKeyToProcessedPrivateKey(privateKeyHex.slice(2))
  const blsPublicKey = bls12377js.BLS.privateToPublicBytes(blsValidatorPrivateKeyBytes).toString(
    'hex'
  )
  const blsPoP = bls12377js.BLS.signPoP(
    blsValidatorPrivateKeyBytes,
    Buffer.from(address.slice(2), 'hex')
  ).toString('hex')
  return publicKey + blsPublicKey + blsPoP
}
