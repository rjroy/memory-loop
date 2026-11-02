import { parseGroundCollection } from './ground-parsers';
import { mergeQuestions, questionCandidates } from './ground-generation-questions';
import { mergeQuotes, quoteCandidates } from './ground-generation-quotes';

export type GenerationJob = 'questions' | 'quotes';

/** Exactly the two resource formats; no registry of jobs or executable persisted strategies. */
export function generationCandidates(job: GenerationJob, source: string, count: number): string {
  return JSON.stringify(job === 'questions' ? questionCandidates(source, count) : quoteCandidates(source, count));
}
export function mergeGenerationCandidates(job: GenerationJob, source: string | null, candidatesJson: string): { output: string | null; writeRequired: boolean } {
  return job === 'questions' ? mergeQuestions(source, questionCandidates(candidatesJson, 50)) : mergeQuotes(source, quoteCandidates(candidatesJson, 50));
}
export function validGenerationOutput(job: GenerationJob, output: string): boolean {
  return (job === 'questions' ? parseGroundCollection('prompts', output) : parseGroundCollection('inspiration', output)).state !== 'malformed';
}
