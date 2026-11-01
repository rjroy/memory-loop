import type { DeleteBlockReason, ThinkErrorCode } from './contract';

export type ThinkServiceErrorCode = Exclude<ThinkErrorCode, 'think_config_missing' | 'think_config_invalid'>;

export class ThinkServiceError extends Error {
  constructor(readonly code: ThinkServiceErrorCode, readonly reason?: DeleteBlockReason) {
    super('Think service request failed');
    this.name = 'ThinkServiceError';
  }
}
