export type SourceKind = 'claude' | 'codex' | 'opencode';
export type MetricKind = 'cost' | 'tokens';

export type UsageEntry = {
	source: SourceKind;
	timestamp: Date;
	model: string;
	provider?: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningOutputTokens: number;
	costUSD: number | null;
};

export type SourceDetection = {
	source: SourceKind;
	label: string;
	available: boolean;
	roots: string[];
	fileCount: number;
};

export type DayBucket = {
	costUSD: number;
	tokens: number;
	entryCount: number;
	unknownCostEntries: number;
};

export type SourceSummary = {
	source: SourceKind;
	label: string;
	month: string;
	dayBuckets: DayBucket[];
	totalCostUSD: number;
	totalTokens: number;
	totalEntries: number;
	unknownCostEntries: number;
};
