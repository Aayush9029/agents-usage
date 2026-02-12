import type { PricingMap } from '../pricing.js';
import type { SourceKind, SourceSummary, UsageEntry } from '../types.js';
import type { RenderSummary } from './types.js';
import { estimateEntryCostUSD } from '../pricing.js';
import {
	makeEmptyDayBuckets,
	monthContainsDate,
	monthDayIndex,
	parseMonthWindow,
	totalTokens,
} from '../utils.js';

export function aggregateSourceSummary(
	source: SourceKind,
	label: string,
	month: string,
	entries: UsageEntry[],
	pricingMap: PricingMap,
	shouldComputeCost: boolean,
): SourceSummary {
	const monthWindow = parseMonthWindow(month);
	const dayBuckets = makeEmptyDayBuckets(monthWindow.daysInMonth);

	for (const entry of entries) {
		if (!monthContainsDate(monthWindow, entry.timestamp)) {
			continue;
		}

		const index = monthDayIndex(entry.timestamp);
		const bucket = dayBuckets[index];
		if (bucket == null) {
			continue;
		}

		bucket.entryCount += 1;
		bucket.tokens += totalTokens(entry);

		if (shouldComputeCost) {
			if (entry.costUSD != null && Number.isFinite(entry.costUSD)) {
				bucket.costUSD += entry.costUSD;
				continue;
			}

			const estimated = estimateEntryCostUSD(pricingMap, entry);
			if (estimated == null) {
				bucket.unknownCostEntries += 1;
			} else {
				bucket.costUSD += estimated;
			}
		}
	}

	let totalCostUSD = 0;
	let totalTokensValue = 0;
	let totalEntries = 0;
	let unknownCostEntries = 0;
	for (const bucket of dayBuckets) {
		totalCostUSD += bucket.costUSD;
		totalTokensValue += bucket.tokens;
		totalEntries += bucket.entryCount;
		unknownCostEntries += bucket.unknownCostEntries;
	}

	return {
		source,
		label,
		month,
		dayBuckets,
		totalCostUSD,
		totalTokens: totalTokensValue,
		totalEntries,
		unknownCostEntries,
	};
}

export function aggregateCombinedSummary(month: string, summaries: SourceSummary[]): RenderSummary {
	const monthWindow = parseMonthWindow(month);
	const dayBuckets = makeEmptyDayBuckets(monthWindow.daysInMonth);

	for (const summary of summaries) {
		for (let index = 0; index < summary.dayBuckets.length; index += 1) {
			const sourceBucket = summary.dayBuckets[index];
			const combinedBucket = dayBuckets[index];
			if (sourceBucket == null || combinedBucket == null) {
				continue;
			}
			combinedBucket.costUSD += sourceBucket.costUSD;
			combinedBucket.tokens += sourceBucket.tokens;
			combinedBucket.entryCount += sourceBucket.entryCount;
			combinedBucket.unknownCostEntries += sourceBucket.unknownCostEntries;
		}
	}

	let totalCostUSD = 0;
	let totalTokensValue = 0;
	let totalEntries = 0;
	let unknownCostEntries = 0;
	for (const bucket of dayBuckets) {
		totalCostUSD += bucket.costUSD;
		totalTokensValue += bucket.tokens;
		totalEntries += bucket.entryCount;
		unknownCostEntries += bucket.unknownCostEntries;
	}

	return {
		label: 'Combined',
		month,
		dayBuckets,
		totalCostUSD,
		totalTokens: totalTokensValue,
		totalEntries,
		unknownCostEntries,
	};
}
