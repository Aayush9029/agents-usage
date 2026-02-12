import type { MetricKind, SourceKind } from '../types.js';
import type { RenderSummary } from './types.js';
import {
	bold,
	color,
	formatCurrency,
	formatNumber,
} from '../utils.js';

const SOURCE_STYLES: Record<
	SourceKind,
	{
		title: string;
		fill: string;
		empty: string;
	}
> = {
	claude: {
		title: '38;5;208', // orange
		fill: '38;5;208',
		empty: '90',
	},
	codex: {
		title: '97', // white (black & white style)
		fill: '97',
		empty: '90',
	},
	opencode: {
		title: '34', // blue
		fill: '34',
		empty: '90',
	},
};

const COMBINED_STYLE = {
	title: '36',
	fill: '36',
	empty: '90',
};

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

function totalByMetric(summary: RenderSummary, metric: MetricKind): number {
	return metric === 'cost' ? summary.totalCostUSD : summary.totalTokens;
}

function renderProgressBar(
	width: number,
	percent: number,
	fillCode: string,
	emptyCode: string,
	colorsEnabled: boolean,
): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * width);
	const filledBar = filled > 0 ? color('█'.repeat(filled), fillCode, colorsEnabled) : '';
	const emptyBar = width - filled > 0 ? color('░'.repeat(width - filled), emptyCode, colorsEnabled) : '';
	return filledBar + emptyBar;
}

function renderSparkline(values: number[]): string {
	const maxValue = Math.max(0, ...values);
	return values
		.map((value) => {
			if (value <= 0 || maxValue === 0) {
				return SPARK_CHARS[0];
			}
			const scaled = Math.round((value / maxValue) * (SPARK_CHARS.length - 1));
			return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, scaled))] ?? SPARK_CHARS[0];
		})
		.join('');
}

export function renderSummaryChart(
	summary: RenderSummary,
	metric: MetricKind,
	colorsEnabled: boolean,
	referenceMax: number,
): string {
	const values = summary.dayBuckets.map((bucket) => (metric === 'cost' ? bucket.costUSD : bucket.tokens));
	const style = summary.source != null ? SOURCE_STYLES[summary.source] : COMBINED_STYLE;
	const metricValue = totalByMetric(summary, metric);
	const denominator = referenceMax > 0 ? referenceMax : metricValue;
	const percent = denominator === 0 ? 0 : Math.round((metricValue / denominator) * 100);
	const terminalWidth = Math.max(80, process.stdout.columns ?? 100);
	const barWidth = Math.max(24, Math.min(58, terminalWidth - 34));

	const lines: string[] = [];
	lines.push(bold(color(summary.label, style.title, colorsEnabled), colorsEnabled));

	if (summary.totalEntries === 0) {
		lines.push(`  ${renderProgressBar(barWidth, 0, style.fill, style.empty, colorsEnabled)}   0% used`);
		lines.push(`  Total cost: ${bold(color(formatCurrency(0), '32', colorsEnabled), colorsEnabled)}`);
		lines.push(`  Total tokens: ${formatNumber(0)}`);
		lines.push(`  Total entries: ${formatNumber(0)}`);
		return lines.join('\n');
	}

	lines.push(`  ${renderProgressBar(barWidth, percent, style.fill, style.empty, colorsEnabled)} ${String(percent).padStart(3, ' ')}% used`);
	lines.push(`  Daily trend: ${color(renderSparkline(values), style.fill, colorsEnabled)}`);
	lines.push(`  Total cost: ${bold(color(formatCurrency(summary.totalCostUSD), '32', colorsEnabled), colorsEnabled)}`);
	lines.push(`  Total tokens: ${formatNumber(summary.totalTokens)}`);
	lines.push(`  Total entries: ${formatNumber(summary.totalEntries)}`);
	if (metric === 'cost' && summary.unknownCostEntries > 0) {
		lines.push(
			`  ${color(
				`Unknown pricing: ${formatNumber(summary.unknownCostEntries)} entries counted as $0.00.`,
				'33',
				colorsEnabled,
			)}`,
		);
	}

	return lines.join('\n');
}
