import type { CliOptions } from './options.js';
import type { MetricKind, SourceDetection, SourceKind } from '../types.js';
import { bold, color, currentMonthString, parseMonthWindow } from '../utils.js';

export async function resolveSources(
	options: CliOptions,
	availableSources: SourceDetection[],
): Promise<SourceKind[]> {
	if (options.sources != null && options.sources.length > 0) {
		const availableKinds = new Set(availableSources.map((item) => item.source));
		const filtered = options.sources.filter((item) => availableKinds.has(item));
		if (filtered.length === 0) {
			const availableLabels = availableSources.map((item) => item.source).join(', ');
			throw new Error(`None of the requested sources are available. Available: ${availableLabels}`);
		}
		return filtered;
	}

	const defaultSources = availableSources
		.filter((item) => item.source === 'claude' || item.source === 'codex')
		.map((item) => item.source);
	if (defaultSources.length > 0) {
		return defaultSources;
	}

	return availableSources.map((item) => item.source);
}

export async function resolveMonth(options: CliOptions): Promise<string> {
	if (options.month != null && options.month !== '') {
		parseMonthWindow(options.month);
		return options.month;
	}

	return currentMonthString();
}

export async function resolveMetric(options: CliOptions): Promise<MetricKind> {
	if (options.metric != null) {
		return options.metric;
	}
	return 'cost';
}

export function printDetections(detections: SourceDetection[], colorsEnabled: boolean): void {
	console.log(bold(color('Detected sources', '34', colorsEnabled), colorsEnabled));
	for (const detection of detections) {
		const status = detection.available
			? color('available', '32', colorsEnabled)
			: color('not found', '90', colorsEnabled);
		const label = color(detection.label, '34', colorsEnabled);
		console.log(`- ${label}: ${status}`);
	}
}
