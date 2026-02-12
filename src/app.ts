import { parseArgs, printHelp } from './cli/options.js';
import { printDetections, resolveMetric, resolveMonth, resolveSources } from './cli/prompts.js';
import { withSpinner } from './cli/spinner.js';
import { detectSources, loadEntriesForSource } from './loaders.js';
import { loadPricingStatus } from './pricing.js';
import { aggregateCombinedSummary, aggregateSourceSummary } from './reporting/aggregate.js';
import { renderSummaryChart } from './reporting/render.js';
import type { SourceDetection, SourceKind, SourceSummary } from './types.js';
import {
	ansiEnabled,
	bold,
	color,
	formatCurrency,
	formatMonthHuman,
	formatNumber,
	SOURCE_LABELS,
} from './utils.js';

function detectionBySource(detections: SourceDetection[]): Map<SourceKind, SourceDetection> {
	const map = new Map<SourceKind, SourceDetection>();
	for (const detection of detections) {
		map.set(detection.source, detection);
	}
	return map;
}

function pricingSourceLabel(source: string): string {
	switch (source) {
		case 'remote':
			return 'live';
		case 'fresh-cache':
			return 'cache';
		case 'stale-cache':
			return 'stale cache';
		case 'offline-cache':
			return 'offline cache';
		case 'offline-empty':
			return 'offline (no cache)';
		case 'unavailable':
			return 'unavailable';
		default:
			return source;
	}
}

export async function runApp(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	if (options.help) {
		printHelp();
		return;
	}

	const colorsEnabled = ansiEnabled(options.noColor);
	const detections = await withSpinner('Detecting available sources...', colorsEnabled, detectSources);
	const available = detections.filter((item) => item.available);

	if (available.length === 0) {
		printDetections(detections, colorsEnabled);
		console.error('\nNo usage data files were found for Claude/Codex sources.');
		process.exitCode = 1;
		return;
	}

	const selectedSources = await resolveSources(options, available);
	const month = await resolveMonth(options);
	const metric = await resolveMetric(options);
	const monthLabel =
		options.month == null || options.month.trim() === ''
			? `This month (${formatMonthHuman(month)})`
			: formatMonthHuman(month);

	const sourceMap = detectionBySource(detections);
	console.log(`${bold('Agents Usage', colorsEnabled)}  ${color(monthLabel, '34', colorsEnabled)}`);

	const loadedEntries = await withSpinner('Loading usage entries...', colorsEnabled, async () =>
		Promise.all(selectedSources.map(async (source) => [source, await loadEntriesForSource(source)] as const)),
	);

	const pricingStatus =
		metric === 'cost'
			? await withSpinner('Loading pricing data...', colorsEnabled, () => loadPricingStatus(options.offline))
			: { pricingMap: {}, isEmpty: false, source: 'unavailable' as const };

	if (metric === 'cost') {
		console.log(`Pricing source: ${color(pricingSourceLabel(pricingStatus.source), '34', colorsEnabled)}`);
	}

	if (metric === 'cost' && pricingStatus.isEmpty) {
		console.log(
			color(
				'Warning: pricing map unavailable (offline/no cache). Unknown models will show $0.00.',
				'33',
				colorsEnabled,
			),
		);
	}

	const summaries: SourceSummary[] = loadedEntries.map(([source, entries]) => {
		const label = sourceMap.get(source)?.label ?? SOURCE_LABELS[source];
		return aggregateSourceSummary(
			source,
			label,
			month,
			entries,
			pricingStatus.pricingMap,
			metric === 'cost',
		);
	});

	const combined = aggregateCombinedSummary(month, summaries);
	if (metric === 'cost') {
		console.log(
			`Total cost (all CLIs): ${bold(color(formatCurrency(combined.totalCostUSD), '32', colorsEnabled), colorsEnabled)}`,
		);
	} else {
		console.log(
			`Total tokens (all CLIs): ${bold(color(formatNumber(combined.totalTokens), '32', colorsEnabled), colorsEnabled)}`,
		);
	}

	const sourceMetricValues = summaries.map((item) =>
		metric === 'cost' ? item.totalCostUSD : item.totalTokens,
	);
	const referenceMax = Math.max(0, ...sourceMetricValues);

	for (let index = 0; index < summaries.length; index += 1) {
		console.log('');
		console.log(renderSummaryChart(summaries[index]!, metric, colorsEnabled, referenceMax));
	}
}
