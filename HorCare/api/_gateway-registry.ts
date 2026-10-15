/**
 * Which payment providers exist and which one is switched on.
 *
 * Adding a gateway = write a PaymentProvider (src/shared/paymentGateway.ts), add one line to `build()` that registers it when
 * its credentials are present, and set PAYMENT_GATEWAY_PROVIDER to its id. Nothing else in billing, the ledger or the
 * webhook changes. See docs/PAYMENT_GATEWAY.md.
 */
import type { PaymentProvider } from '../src/shared/paymentGateway.js';
import { sandboxProvider } from './_gateways/sandbox.js';

/** Providers whose credentials are configured right now. Built per call so tests (and env changes) take effect. */
function build(): Map<string, PaymentProvider> {
    const providers = new Map<string, PaymentProvider>();
    const sandboxSecret = process.env.PAYMENT_GATEWAY_SANDBOX_SECRET;
    if (sandboxSecret) providers.set('sandbox', sandboxProvider(sandboxSecret));
    // future: if (process.env.HORCARE_GATEWAY_KEY && process.env.HORCARE_GATEWAY_SECRET) providers.set('horcare', horcareProvider(...));
    return providers;
}

export const configuredProviders = (): PaymentProvider[] => [...build().values()];
export const getProvider = (id: unknown): PaymentProvider | null => (typeof id === 'string' ? build().get(id) ?? null : null);

/** The provider new intents are created with: PAYMENT_GATEWAY_PROVIDER, if it is configured. null = gateway off. */
export function activeProvider(): PaymentProvider | null {
    const id = process.env.PAYMENT_GATEWAY_PROVIDER;
    return id ? getProvider(id) : null;
}
