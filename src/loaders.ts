import type { SourceDetection, SourceKind, UsageEntry } from './types.js';
import {
	getHomeDirectory,
	isDirectory,
	listFilesRecursively,
	normalizeNumber,
	readJsonlLines,
	SOURCE_LABELS,
	splitCommaList,
} from './utils.js';
import path from 'node:path';

type CodexRawUsage = {
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	reasoning_output_tokens: number;
	total_tokens: number;
};

function getClaudeRoots(): string[] {
	const env = process.env.CLAUDE_CONFIG_DIR?.trim();
	if (env != null && env !== '') {
		return splitCommaList(env).map((value) => path.resolve(value));
	}

	const home = getHomeDirectory();
	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	const xdgRoot = xdg != null && xdg !== '' ? xdg : path.join(home, '.config');
	return [path.join(xdgRoot, 'claude'), path.join(home, '.claude')];
}

function getCodexRoot(): string {
	const env = process.env.CODEX_HOME?.trim();
	if (env != null && env !== '') {
		return path.resolve(env);
	}
	return path.join(getHomeDirectory(), '.codex');
}

async function detectClaudeSource(): Promise<SourceDetection> {
	const roots = getClaudeRoots();
	let totalFiles = 0;

	for (const root of roots) {
		const projectsDir = path.join(root, 'projects');
		if (!(await isDirectory(projectsDir))) {
			continue;
		}
		const files = await listFilesRecursively(projectsDir, '.jsonl', 5);
		totalFiles += files.length;
	}

	return {
		source: 'claude',
		label: SOURCE_LABELS.claude,
		available: totalFiles > 0,
		roots,
		fileCount: totalFiles,
	};
}

async function detectCodexSource(): Promise<SourceDetection> {
	const root = getCodexRoot();
	const sessionsDir = path.join(root, 'sessions');
	const files = await listFilesRecursively(sessionsDir, '.jsonl', 5);
	return {
		source: 'codex',
		label: SOURCE_LABELS.codex,
		available: files.length > 0,
		roots: [root],
		fileCount: files.length,
	};
}

export async function detectSources(): Promise<SourceDetection[]> {
	const [claude, codex] = await Promise.all([
		detectClaudeSource(),
		detectCodexSource(),
	]);
	return [claude, codex];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function extractModel(value: unknown): string | undefined {
	const record = asRecord(value);
	if (record == null) {
		return undefined;
	}

	const direct = [
		record.model,
		record.model_name,
		record.modelID,
		record.modelId,
		record.model_name_for_display,
	];
	for (const candidate of direct) {
		const text = asTrimmedString(candidate);
		if (text != null) {
			return text;
		}
	}

	const infoModel = extractModel(record.info);
	if (infoModel != null) {
		return infoModel;
	}

	const metadataRecord = asRecord(record.metadata);
	if (metadataRecord != null) {
		const metadataModel = asTrimmedString(metadataRecord.model);
		if (metadataModel != null) {
			return metadataModel;
		}
	}

	return undefined;
}

function normalizeCodexRawUsage(value: unknown): CodexRawUsage | null {
	const record = asRecord(value);
	if (record == null) {
		return null;
	}

	const input = normalizeNumber(record.input_tokens);
	const cached = normalizeNumber(record.cached_input_tokens ?? record.cache_read_input_tokens);
	const output = normalizeNumber(record.output_tokens);
	const reasoning = normalizeNumber(record.reasoning_output_tokens);
	const total = normalizeNumber(record.total_tokens);

	return {
		input_tokens: input,
		cached_input_tokens: cached,
		output_tokens: output,
		reasoning_output_tokens: reasoning,
		total_tokens: total > 0 ? total : input + output,
	};
}

function subtractCodexUsage(
	current: CodexRawUsage,
	previous: CodexRawUsage | null,
): CodexRawUsage {
	return {
		input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
		cached_input_tokens: Math.max(current.cached_input_tokens - (previous?.cached_input_tokens ?? 0), 0),
		output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
		reasoning_output_tokens: Math.max(
			current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0),
			0,
		),
		total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0),
	};
}

async function loadClaudeEntries(): Promise<UsageEntry[]> {
	const entries: UsageEntry[] = [];
	const dedupe = new Set<string>();

	for (const root of getClaudeRoots()) {
		const projectsDir = path.join(root, 'projects');
		const files = await listFilesRecursively(projectsDir, '.jsonl');
		for (const filePath of files) {
			const parsedLines = await readJsonlLines(filePath);
			for (const parsedLine of parsedLines) {
				const lineRecord = asRecord(parsedLine);
				if (lineRecord == null) {
					continue;
				}
				const messageRecord = asRecord(lineRecord.message);
				const usageRecord = asRecord(messageRecord?.usage);
				if (usageRecord == null) {
					continue;
				}

				const timestamp = asTrimmedString(lineRecord.timestamp);
				if (timestamp == null) {
					continue;
				}
				const date = new Date(timestamp);
				if (Number.isNaN(date.getTime())) {
					continue;
				}

				const messageId = asTrimmedString(messageRecord?.id);
				const requestId = asTrimmedString(lineRecord.requestId);
				if (messageId != null && requestId != null) {
					const key = `${messageId}:${requestId}`;
					if (dedupe.has(key)) {
						continue;
					}
					dedupe.add(key);
				}

				const inputTokens = normalizeNumber(usageRecord.input_tokens);
				const outputTokens = normalizeNumber(usageRecord.output_tokens);
				const cacheWriteTokens = normalizeNumber(usageRecord.cache_creation_input_tokens);
				const cacheReadTokens = normalizeNumber(usageRecord.cache_read_input_tokens);
				if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) {
					continue;
				}

				const model =
					asTrimmedString(messageRecord?.model) ??
					asTrimmedString(lineRecord.model) ??
					'unknown';
				const rawCost = lineRecord.costUSD;
				const costUSD = typeof rawCost === 'number' && Number.isFinite(rawCost) ? rawCost : null;

				entries.push({
					source: 'claude',
					timestamp: date,
					model,
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
					reasoningOutputTokens: 0,
					costUSD,
				});
			}
		}
	}

	return entries;
}

async function loadCodexEntries(): Promise<UsageEntry[]> {
	const root = getCodexRoot();
	const sessionsDir = path.join(root, 'sessions');
	const files = await listFilesRecursively(sessionsDir, '.jsonl');
	const entries: UsageEntry[] = [];

	for (const filePath of files) {
		const parsedLines = await readJsonlLines(filePath);
		let previousTotals: CodexRawUsage | null = null;
		let currentModel: string | undefined;

		for (const parsedLine of parsedLines) {
			const lineRecord = asRecord(parsedLine);
			if (lineRecord == null) {
				continue;
			}

			const type = asTrimmedString(lineRecord.type);
			if (type === 'turn_context') {
				const contextModel = extractModel(lineRecord.payload);
				if (contextModel != null) {
					currentModel = contextModel;
				}
				continue;
			}

			if (type !== 'event_msg') {
				continue;
			}

			const payload = asRecord(lineRecord.payload);
			if (payload == null || asTrimmedString(payload.type) !== 'token_count') {
				continue;
			}

			const timestamp = asTrimmedString(lineRecord.timestamp);
			if (timestamp == null) {
				continue;
			}
			const date = new Date(timestamp);
			if (Number.isNaN(date.getTime())) {
				continue;
			}

			const info = asRecord(payload.info);
			const lastUsage = normalizeCodexRawUsage(info?.last_token_usage);
			const totalUsage = normalizeCodexRawUsage(info?.total_token_usage);

			let rawUsage: CodexRawUsage | null = null;
			// Prefer delta-from-total usage when available.
			// Codex logs often repeat identical token_count events; total deltas naturally dedupe them.
			if (totalUsage != null) {
				rawUsage = subtractCodexUsage(totalUsage, previousTotals);
				previousTotals = totalUsage;
			} else if (lastUsage != null) {
				rawUsage = lastUsage;
			}
			if (rawUsage == null) {
				continue;
			}

			const modelFromPayload = extractModel(payload) ?? extractModel(info);
			if (modelFromPayload != null) {
				currentModel = modelFromPayload;
			}
			const model = modelFromPayload ?? currentModel ?? 'gpt-5';

			const inputTokens = rawUsage.input_tokens;
			const cacheReadTokens = Math.min(rawUsage.cached_input_tokens, inputTokens);
			const outputTokens = rawUsage.output_tokens;
			const reasoningOutputTokens = rawUsage.reasoning_output_tokens;
			if (inputTokens + outputTokens + cacheReadTokens + reasoningOutputTokens === 0) {
				continue;
			}

			entries.push({
				source: 'codex',
				timestamp: date,
				model,
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens: 0,
				reasoningOutputTokens,
				costUSD: null,
			});
		}
	}

	return entries;
}

export async function loadEntriesForSource(source: SourceKind): Promise<UsageEntry[]> {
	switch (source) {
		case 'claude':
			return loadClaudeEntries();
		case 'codex':
			return loadCodexEntries();
	}
}
