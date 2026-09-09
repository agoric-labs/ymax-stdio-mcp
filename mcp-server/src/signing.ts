import {
  makeSigningSmartWalletKitFromClient,
  makeStargateClientKit,
  type SmartWalletKit,
} from '@agoric/client-utils';
import { SigningStargateClient } from '@cosmjs/stargate';
import { delegateHdPath } from './hd-path.ts';
import type { DelegateState } from './types.ts';

/**
 * Like `makeSigningSmartWalletKit`, but derives the signer at the delegate's
 * own `hdPath` rather than the library default, and refuses to sign as an
 * address the owner never granted.
 */
export async function makeDelegateSigningKit(
  walletKit: SmartWalletKit,
  delegate: DelegateState,
) {
  const hdPath = delegateHdPath(delegate);
  const { address, client } = await makeStargateClientKit(delegate.mnemonic, {
    connectWithSigner: SigningStargateClient.connectWithSigner,
    // XXX always the first, matching makeSigningSmartWalletKit
    rpcAddr: walletKit.networkConfig.rpcAddrs[0],
    hdPath,
  });

  // Without this the mismatch surfaces from the chain as an opaque "account
  // does not exist", which reads like a network or funding problem.
  if (address !== delegate.address) {
    throw new Error(
      `delegate mnemonic derives ${address} at ${hdPath}, but state records ${delegate.address}; ` +
        'set hdPath to the path the grant was made under',
    );
  }

  return makeSigningSmartWalletKitFromClient({
    smartWalletKit: walletKit,
    address,
    client,
  });
}
