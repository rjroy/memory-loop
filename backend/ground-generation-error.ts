/** Safe job diagnostics, never native errors or note contents. */
export class GroundGenerationError extends Error {
  constructor(readonly code: 'unavailable' | 'configuration' | 'conflict') {
    super(`ground generation ${code}`);
  }
}
