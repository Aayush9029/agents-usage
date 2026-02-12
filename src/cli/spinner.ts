import { color } from '../utils.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export async function withSpinner<T>(
	message: string,
	colorsEnabled: boolean,
	work: () => Promise<T>,
): Promise<T> {
	if (!process.stdout.isTTY) {
		return work();
	}

	let index = 0;
	const render = (): void => {
		const frame = FRAMES[index % FRAMES.length] ?? FRAMES[0];
		process.stdout.write(`\r${color(frame, '36', colorsEnabled)} ${message}`);
		index += 1;
	};

	render();
	const timer = setInterval(render, 80);

	try {
		const result = await work();
		clearInterval(timer);
		process.stdout.write(`\r${color('✔', '32', colorsEnabled)} ${message}\n`);
		return result;
	} catch (error) {
		clearInterval(timer);
		process.stdout.write(`\r${color('✖', '31', colorsEnabled)} ${message}\n`);
		throw error;
	}
}
