import { createContext, useContext } from 'react';
import type { OwnerSignature } from '../../shared/ownerSignature';

/**
 * The owner's saved signature, for every document rendered inside the app (App provides it). Outside the app — the
 * tenant portal — nothing is provided and documents take the signature from their `issuer` instead.
 */
export const OwnerSignatureContext = createContext<OwnerSignature | null>(null);

/** The saved signature, or null when the owner has not drawn one. */
export const useOwnerSignatureCtx = () => useContext(OwnerSignatureContext);
