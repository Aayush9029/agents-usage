import type { DayBucket, SourceKind } from '../types.js';

export type RenderSummary = {
	label: string;
	month: string;
	dayBuckets: DayBucket[];
	totalCostUSD: number;
	totalTokens: number;
	totalEntries: number;
	unknownCostEntries: number;
	source?: SourceKind;
};
