import type { DayBucket, UsageEntry } from './types.js';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SOURCE_LABELS = {
	claude: 'Claude',
	codex: 'Codex',
} as const;

export type MonthWindow = {
	month: string;
	year: number;
	monthIndex: number;
	start: Date;
	endExclusive: Date;
	daysInMonth: number;
};

export function parseMonthWindow(monthInput: string): MonthWindow {
	const trimmed = monthInput.trim();
	const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
	if (match == null) {
		throw new Error(`Invalid month "${monthInput}". Expected YYYY-MM.`);
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error(`Invalid month "${monthInput}". Expected YYYY-MM.`);
	}

	const monthIndex = month - 1;
	const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
	const endExclusive = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
	const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

	return {
		month: `${year}-${String(month).padStart(2, '0')}`,
		year,
		monthIndex,
		start,
		endExclusive,
		daysInMonth,
	};
}

export function currentMonthString(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthHuman(monthInput: string): string {
	const { year, monthIndex } = parseMonthWindow(monthInput);
	const date = new Date(year, monthIndex, 1);
	return date.toLocaleString('en-US', {
		month: 'long',
		year: 'numeric',
	});
}

export async function isDirectory(dirPath: string): Promise<boolean> {
	try {
		const info = await stat(dirPath);
		return info.isDirectory();
	} catch {
		return false;
	}
}

export async function listFilesRecursively(
	rootDir: string,
	extension: string,
	limit = Number.POSITIVE_INFINITY,
): Promise<string[]> {
	const files: string[] = [];
	if (!(await isDirectory(rootDir))) {
		return files;
	}

	const stack = [rootDir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current == null) {
			continue;
		}

		try {
			const entries = await readdir(current, { withFileTypes: true, encoding: 'utf8' });
			for (const entry of entries) {
				const fullPath = path.join(current, entry.name);
				if (entry.isDirectory()) {
					stack.push(fullPath);
					continue;
				}
				if (!entry.isFile()) {
					continue;
				}
				if (!fullPath.endsWith(extension)) {
					continue;
				}
				files.push(fullPath);
				if (files.length >= limit) {
					files.sort();
					return files;
				}
			}
		} catch {
			continue;
		}
	}

	files.sort();
	return files;
}

export async function readJsonlLines(filePath: string): Promise<unknown[]> {
	let content: string;
	try {
		content = await readFile(filePath, 'utf8');
	} catch {
		return [];
	}

	const lines = content.split(/\r?\n/);
	const parsed: unknown[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') {
			continue;
		}
		try {
			parsed.push(JSON.parse(trimmed));
		} catch {
			// ignore invalid JSON lines
		}
	}
	return parsed;
}

export function normalizeNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

export function formatCurrency(value: number): string {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function totalTokens(entry: UsageEntry): number {
	return (
		entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens
	);
}

export function makeEmptyDayBuckets(daysInMonth: number): DayBucket[] {
	return Array.from({ length: daysInMonth }, () => ({
		costUSD: 0,
		tokens: 0,
		entryCount: 0,
		unknownCostEntries: 0,
	}));
}

export function monthContainsDate(month: MonthWindow, date: Date): boolean {
	return date >= month.start && date < month.endExclusive;
}

export function monthDayIndex(date: Date): number {
	return date.getDate() - 1;
}

export function getHomeDirectory(): string {
	return os.homedir();
}

export async function ensureParentDir(filePath: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const content = await readFile(filePath, 'utf8');
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
	await ensureParentDir(filePath);
	await writeFile(filePath, JSON.stringify(value), 'utf8');
}

export function splitCommaList(input: string): string[] {
	return input
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

export function ansiEnabled(noColorFlag: boolean): boolean {
	return !noColorFlag && process.env.NO_COLOR == null;
}

export function color(text: string, code: string, enabled: boolean): string {
	if (!enabled) {
		return text;
	}
	return `\x1b[${code}m${text}\x1b[0m`;
}

export function bold(text: string, enabled: boolean): string {
	return color(text, '1', enabled);
}
