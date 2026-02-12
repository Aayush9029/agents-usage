import type { SourceKind, UsageEntry } from './types.js';
import { getHomeDirectory, readJsonFile, writeJsonFile } from './utils.js';
import path from 'node:path';

export type PricingRecord = {
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	cache_creation_input_token_cost?: number;
	cache_read_input_token_cost?: number;
	input_cost_per_token_above_200k_tokens?: number;
	output_cost_per_token_above_200k_tokens?: number;
	cache_creation_input_token_cost_above_200k_tokens?: number;
	cache_read_input_token_cost_above_200k_tokens?: number;
};

export type PricingMap = Record<string, PricingRecord>;

type PricingCacheFile = {
	fetchedAt: string;
	data: PricingMap;
};

export type PricingSource =
	| 'fresh-cache'
	| 'remote'
	| 'stale-cache'
	| 'offline-cache'
	| 'offline-empty'
	| 'unavailable';

const LITELLM_PRICING_URL =
	'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_FILE = path.join(getHomeDirectory(), '.agents-usage', 'litellm-pricing-cache.json');
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

const MODEL_ALIASES = new Map<string, string>([
	['gpt-5-codex', 'gpt-5'],
	['gpt-5-codex-high', 'gpt-5'],
	['gpt-5-codex-low', 'gpt-5'],
	['gpt-5-codex-max', 'gpt-5'],
	['gemini-3-pro-high', 'gemini-3-pro-preview'],
]);

function isFresh(timestamp: string): boolean {
	const time = new Date(timestamp).getTime();
	if (!Number.isFinite(time)) {
		return false;
	}
	return Date.now() - time < CACHE_MAX_AGE_MS;
}

async function readCache(): Promise<PricingCacheFile | null> {
	const cached = await readJsonFile<PricingCacheFile>(CACHE_FILE);
	if (cached == null || typeof cached !== 'object' || cached.data == null) {
		return null;
	}
	if (!isFresh(cached.fetchedAt)) {
		return null;
	}
	return cached;
}

async function writeCache(data: Record<string, PricingRecord>): Promise<void> {
	const payload: PricingCacheFile = {
		fetchedAt: new Date().toISOString(),
		data,
	};
	await writeJsonFile(CACHE_FILE, payload);
}

async function fetchLiteLLMPricing(): Promise<PricingMap | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(LITELLM_PRICING_URL, {
			signal: controller.signal,
			headers: {
				'user-agent': 'agents-usage/0.1.0',
			},
		});
		if (!response.ok) {
			return null;
		}

		const parsed = (await response.json()) as unknown;
		if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}
		const data = parsed as PricingMap;
		await writeCache(data);
		return data;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function maybeVersionAlias(model: string): string[] {
	const aliases = new Set<string>();
	const codexVersionMatch = /^(gpt-\d+)\.\d+(-codex(?:-(?:mini|max|high|low))?)$/i.exec(model);
	if (codexVersionMatch != null) {
		const major = codexVersionMatch[1];
		const suffix = codexVersionMatch[2];
		if (major != null && suffix != null) {
			aliases.add(`${major}${suffix}`);
		}
	}

	const gptVersionMatch = /^(gpt-\d+)\.\d+$/i.exec(model);
	if (gptVersionMatch != null) {
		const major = gptVersionMatch[1];
		if (major != null) {
			aliases.add(major);
		}
	}

	if (model.endsWith('-latest')) {
		aliases.add(model.slice(0, -'-latest'.length));
	}

	return [...aliases];
}

function modelVariants(model: string): string[] {
	const variants = new Set<string>();
	const trimmed = model.trim();
	if (trimmed !== '') {
		variants.add(trimmed);
	}
	for (const alias of maybeVersionAlias(trimmed)) {
		variants.add(alias);
	}
	for (const candidate of [...variants]) {
		const explicitAlias = MODEL_ALIASES.get(candidate);
		if (explicitAlias != null) {
			variants.add(explicitAlias);
		}
	}
	return [...variants];
}

export async function loadPricingMap(offline: boolean): Promise<PricingMap> {
	const status = await loadPricingStatus(offline);
	return status.pricingMap;
}

export async function loadPricingStatus(offline: boolean): Promise<PricingStatus> {
	const cached = await readCache();
	if (offline) {
		const stale = await readJsonFile<PricingCacheFile>(CACHE_FILE);
		if (stale?.data != null) {
			return {
				pricingMap: stale.data,
				isEmpty: Object.keys(stale.data).length === 0,
				source: 'offline-cache',
			};
		}
		return {
			pricingMap: {},
			isEmpty: true,
			source: 'offline-empty',
		};
	}

	const fetched = await fetchLiteLLMPricing();
	if (fetched != null) {
		return {
			pricingMap: fetched,
			isEmpty: Object.keys(fetched).length === 0,
			source: 'remote',
		};
	}

	if (cached != null) {
		return {
			pricingMap: cached.data,
			isEmpty: Object.keys(cached.data).length === 0,
			source: 'fresh-cache',
		};
	}

	const stale = await readJsonFile<PricingCacheFile>(CACHE_FILE);
	if (stale?.data != null) {
		return {
			pricingMap: stale.data,
			isEmpty: Object.keys(stale.data).length === 0,
			source: 'stale-cache',
		};
	}

	return {
		pricingMap: {},
		isEmpty: true,
		source: 'unavailable',
	};
}

function toNonEmpty(value: string | undefined): string[] {
	if (value == null) {
		return [];
	}
	const trimmed = value.trim();
	return trimmed === '' ? [] : [trimmed];
}

function pricingCandidates(entry: UsageEntry): string[] {
	const model = entry.model.trim();
	const provider = entry.provider?.trim();
	const baseModels = modelVariants(model);
	const candidates = new Set<string>(baseModels);

	for (const baseModel of baseModels) {
		for (const providerPrefix of toNonEmpty(provider)) {
			candidates.add(`${providerPrefix}/${baseModel}`);
		}
		if (entry.source === 'claude') {
			candidates.add(`anthropic/${baseModel}`);
			candidates.add(`vertex_ai/${baseModel}`);
		}
		if (entry.source === 'codex') {
			candidates.add(`openai/${baseModel}`);
			candidates.add(`azure/${baseModel}`);
			candidates.add(`openrouter/openai/${baseModel}`);
		}
	}

	return [...candidates];
}

function resolvePricing(
	pricingMap: PricingMap,
	entry: UsageEntry,
): PricingRecord | null {
	const candidates = pricingCandidates(entry);
	for (const candidate of candidates) {
		const match = pricingMap[candidate];
		if (match != null) {
			return match;
		}
	}

	// Slow fallback: match keys that end with "/model".
	const suffixes = candidates.map((candidate) => `/${candidate}`);
	for (const [key, value] of Object.entries(pricingMap)) {
		for (const suffix of suffixes) {
			if (key.endsWith(suffix)) {
				return value;
			}
		}
	}

	// ccusage-style fuzzy fallback: match by substring in either direction.
	const modelLower = entry.model.trim().toLowerCase();
	let best: { score: number; pricing: PricingRecord } | null = null;
	for (const [key, value] of Object.entries(pricingMap)) {
		const keyLower = key.toLowerCase();
		const isMatch = keyLower.includes(modelLower) || modelLower.includes(keyLower);
		if (!isMatch) {
			continue;
		}

		const score = Math.min(modelLower.length, keyLower.length);
		if (best == null || score > best.score) {
			best = {
				score,
				pricing: value,
			};
		}
	}
	if (best != null) {
		return best.pricing;
	}

	return null;
}

function safeCost(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function calculateTieredCost(
	totalTokens: number,
	basePrice: number | undefined,
	tieredPrice: number | undefined,
	threshold = 200_000,
): number {
	if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
		return 0;
	}

	const base = safeCost(basePrice);
	const tiered = safeCost(tieredPrice);
	if (totalTokens > threshold && tiered > 0) {
		const below = Math.min(totalTokens, threshold);
		const above = Math.max(0, totalTokens - threshold);
		return below * base + above * tiered;
	}

	return totalTokens * base;
}

export function estimateEntryCostUSD(
	pricingMap: PricingMap,
	entry: UsageEntry,
): number | null {
	const pricing = resolvePricing(pricingMap, entry);
	if (pricing == null) {
		return null;
	}

	const isCodexLikeInput = entry.source === 'codex';
	const cacheRead = isCodexLikeInput
		? Math.max(Math.min(entry.cacheReadTokens, entry.inputTokens), 0)
		: Math.max(entry.cacheReadTokens, 0);
	const nonCachedInput = isCodexLikeInput
		? Math.max(entry.inputTokens - cacheRead, 0)
		: Math.max(entry.inputTokens, 0);
	const cacheWrite = Math.max(entry.cacheWriteTokens, 0);
	// Codex logs separate reasoning_output_tokens from output_tokens; bill them as output tokens.
	const output = Math.max(
		entry.outputTokens + (entry.source === 'codex' ? entry.reasoningOutputTokens : 0),
		0,
	);

	const total =
		calculateTieredCost(
			nonCachedInput,
			pricing.input_cost_per_token,
			pricing.input_cost_per_token_above_200k_tokens,
		) +
		calculateTieredCost(
			output,
			pricing.output_cost_per_token,
			pricing.output_cost_per_token_above_200k_tokens,
		) +
		calculateTieredCost(
			cacheWrite,
			pricing.cache_creation_input_token_cost,
			pricing.cache_creation_input_token_cost_above_200k_tokens,
		) +
		calculateTieredCost(
			cacheRead,
			pricing.cache_read_input_token_cost,
			pricing.cache_read_input_token_cost_above_200k_tokens,
		);

	return Number.isFinite(total) ? total : null;
}

export type PricingStatus = {
	pricingMap: PricingMap;
	isEmpty: boolean;
	source: PricingSource;
};

export function hasKnownCost(entry: UsageEntry): boolean {
	return entry.costUSD != null && Number.isFinite(entry.costUSD);
}

export function sourceSupportsServerPricing(source: SourceKind): boolean {
	return source === 'codex' || source === 'opencode' || source === 'claude';
}
