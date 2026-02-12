import type { MetricKind, SourceKind } from '../types.js';
import { splitCommaList } from '../utils.js';

export type CliOptions = {
	sources?: SourceKind[];
	month?: string;
	metric?: MetricKind;
	offline: boolean;
	noColor: boolean;
	nonInteractive: boolean;
	help: boolean;
};

function parseSourceKind(input: string): SourceKind | null {
	switch (input) {
		case 'claude':
		case 'cloud':
		case 'cloudcode':
		case 'cloud-code':
			return 'claude';
		case 'codex':
		case 'codecs':
			return 'codex';
		default:
			return null;
	}
}

function parseMetric(input: string): MetricKind | null {
	const normalized = input.trim().toLowerCase();
	if (normalized === 'cost' || normalized === 'usd' || normalized === '1') {
		return 'cost';
	}
	if (normalized === 'tokens' || normalized === 'token' || normalized === '2') {
		return 'tokens';
	}
	return null;
}

export function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		offline: false,
		noColor: false,
		nonInteractive: false,
		help: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg == null) {
			continue;
		}

		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}
		if (arg === '--offline') {
			options.offline = true;
			continue;
		}
		if (arg === '--no-color') {
			options.noColor = true;
			continue;
		}
		if (arg === '--non-interactive') {
			options.nonInteractive = true;
			continue;
		}

		if (arg === '--sources' || arg === '-s') {
			const raw = argv[i + 1];
			if (raw == null) {
				throw new Error('Missing value after --sources');
			}
			i += 1;
			const parsed = splitCommaList(raw).map((part) => {
				const source = parseSourceKind(part.toLowerCase());
				if (source == null) {
					throw new Error(`Unknown source "${part}". Use: claude,codex`);
				}
				return source;
			});
			options.sources = [...new Set(parsed)];
			continue;
		}
		if (arg.startsWith('--sources=')) {
			const raw = arg.slice('--sources='.length);
			const parsed = splitCommaList(raw).map((part) => {
				const source = parseSourceKind(part.toLowerCase());
				if (source == null) {
					throw new Error(`Unknown source "${part}". Use: claude,codex`);
				}
				return source;
			});
			options.sources = [...new Set(parsed)];
			continue;
		}

		if (arg === '--month' || arg === '-m') {
			const raw = argv[i + 1];
			if (raw == null) {
				throw new Error('Missing value after --month');
			}
			i += 1;
			options.month = raw.trim();
			continue;
		}
		if (arg.startsWith('--month=')) {
			options.month = arg.slice('--month='.length).trim();
			continue;
		}

		if (arg === '--metric') {
			const raw = argv[i + 1];
			if (raw == null) {
				throw new Error('Missing value after --metric');
			}
			i += 1;
			const metric = parseMetric(raw);
			if (metric == null) {
				throw new Error(`Unknown metric "${raw}". Use: cost or tokens`);
			}
			options.metric = metric;
			continue;
		}
		if (arg.startsWith('--metric=')) {
			const metric = parseMetric(arg.slice('--metric='.length));
			if (metric == null) {
				throw new Error(`Unknown metric "${arg.slice('--metric='.length)}". Use: cost or tokens`);
			}
			options.metric = metric;
			continue;
		}

		throw new Error(`Unknown argument "${arg}". Run with --help.`);
	}

	return options;
}

export function printHelp(): void {
	console.log(
		[
			'Usage: agents-usage [options]',
			'',
			'Defaults:',
			'- Sources: Claude + Codex',
			'- Month: current month',
			'- Metric: cost',
			'',
			'Options:',
			'  -s, --sources <list>    Comma list: claude,codex',
			'  -m, --month <YYYY-MM>   Month to chart',
			'      --metric <name>     cost | tokens',
			'      --offline           Do not fetch remote pricing data',
			'      --no-color          Disable ANSI colors',
			'      --non-interactive   Skip prompts (uses flags/defaults)',
			'  -h, --help              Show help',
		].join('\n'),
	);
}
