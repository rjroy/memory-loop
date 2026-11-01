export type GroundResource = 'quickActions' | 'inspiration' | 'prompts' | 'goals';
export type GroundIssueCode = 'invalid_utf8' | 'too_large' | 'invalid_format' | 'too_many_entries';
export type ResourceRead<T> =
  | { state: 'ready'; noteId: string[]; revision: string; data: T }
  | { state: 'empty' | 'missing'; noteId: string[] }
  | { state: 'malformed'; noteId: string[]; issue: { code: GroundIssueCode; line?: number } }
  | { state: 'unavailable'; reason: 'configuration' | 'io'; noteId?: string[] };
export interface QuickAction { id: string; skill: string; description: string }
export interface GroundQuote { id: string; text: string; attribution: string; source?: { title: string; url?: string } }
export interface GroundQuestion { id: string; text: string }
export interface QuickActionsData { actions: QuickAction[] }
export interface InspirationData { quote: GroundQuote }
export interface PromptsData { question: GroundQuestion }
export interface GoalsData { markdown: string }
export interface GroundResourceData {
  quickActions: QuickActionsData;
  inspiration: InspirationData;
  prompts: PromptsData;
  goals: GoalsData;
}
export interface CaptureItem { id: string; localDateTime: string; timeBasis: 'recorded-local'; excerpt: string; noteId: string[] }
export type CapturesRead = { state: 'ready'; coverage: 'complete' | 'partial'; items: CaptureItem[] } |
  { state: 'empty' | 'missing' } | { state: 'malformed'; issue: { code: 'source_coverage' } } |
  { state: 'unavailable'; reason: 'configuration' | 'io' };
