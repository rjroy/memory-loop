import type { ThinkErrorCode } from './contract';

export type ThinkServiceErrorCode = Exclude<ThinkErrorCode, 'think_config_missing' | 'think_config_invalid'>;

export class ThinkServiceError extends Error {
  constructor(readonly code: ThinkServiceErrorCode) {
    super('Think service request failed');
    this.name = 'ThinkServiceError';
  }
}
