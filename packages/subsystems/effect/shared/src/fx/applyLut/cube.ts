export type LutDomain = [number, number, number];
export type CubeLutTable = {
	size: number;
	min: LutDomain;
	max: LutDomain;
	/** GPUへ転送するRGBA。RGBはデータでありpremultiplyしない。 */
	values: Float32Array;
};
export type CubeLut = { oneDimensional: CubeLutTable | null; threeDimensional: CubeLutTable | null };

// 3Dの必要量は辺長の3乗で増える。宣言だけで巨大な確保を起こさないよう、
// ファイルサイズとテーブル寸法をそれぞれ制限する。33・65など非2冪も受け付ける。
export const MAX_CUBE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_1D_SIZE = 65536;
const MAX_3D_SIZE = 128;
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseCubeLut(text: string): CubeLut {
	if (text.length > MAX_CUBE_FILE_BYTES) throw new Error('Cube LUT exceeds the 128 MiB text limit.');
	let size1d = 0;
	let size3d = 0;
	let domainMin: LutDomain = [0, 0, 0];
	let domainMax: LutDomain = [1, 1, 1];
	let range1d: [number, number] | null = null;
	let range3d: [number, number] | null = null;
	const headers = new Set<string>();
	let result: CubeLut | null = null;
	let row = 0;
	let lineNumber = 0;
	const fail = (message: string): never => { throw new Error(`Cube LUT line ${lineNumber}: ${message}`); };
	const numbers = (tokens: string[], count: number): number[] => {
		if (tokens.length !== count) fail(`Expected ${count} numeric values.`);
		return tokens.map(token => {
			const value = Number(token);
			if (!numberPattern.test(token) || !Number.isFinite(Math.fround(value))) fail(`Invalid finite number: ${token}`);
			return Math.fround(value);
		});
	};
	const table = (size: number, dimensions: number, range: [number, number] | null): CubeLutTable | null => {
		if (size === 0) return null;
		const min: LutDomain = range == null ? domainMin : [range[0], range[0], range[0]];
		const max: LutDomain = range == null ? domainMax : [range[1], range[1], range[1]];
		for (let channel = 0; channel < 3; channel++) {
			const span = Math.fround(max[channel] - min[channel]);
			if (!(span > 0) || !Number.isFinite(span) || !Number.isFinite(Math.fround(1 / span))) fail('Input domain must have a finite, positive span.');
		}
		return { size, min, max, values: new Float32Array(size ** dimensions * 4) };
	};
	const beginData = (): CubeLut => {
		if (size1d === 0 && size3d === 0) fail('Missing LUT_1D_SIZE or LUT_3D_SIZE.');
		if ((range1d != null && size1d === 0) || (range3d != null && size3d === 0)) fail('Input range has no corresponding LUT.');
		const hasDomain = headers.has('DOMAIN_MIN') || headers.has('DOMAIN_MAX');
		if (hasDomain && size1d > 0 && size3d > 0) fail('DOMAIN_MIN/MAX is ambiguous for a combined LUT; use per-stage INPUT_RANGE.');
		const range = range1d ?? range3d;
		if (hasDomain && range != null && (domainMin.some(value => value !== range[0]) || domainMax.some(value => value !== range[1]))) fail('DOMAIN_MIN/MAX conflicts with INPUT_RANGE.');
		return { oneDimensional: table(size1d, 1, range1d), threeDimensional: table(size3d, 3, range3d) };
	};
	// splitで全行の配列を作ると、大きいLUTでテキスト以外の一時メモリも膨らむ。
	for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
		lineNumber++;
		let line = match[0].trim();
		if (line === '' || line.startsWith('#')) continue;
		if (/^TITLE\s/.test(line)) {
			if (result != null || headers.has('TITLE') || !/^TITLE\s+"[^"]*"\s*(?:#.*)?$/.test(line)) fail('Invalid or misplaced TITLE.');
			headers.add('TITLE');
			continue;
		}
		line = line.split('#', 1)[0].trim();
		const [keyword, ...tokens] = line.split(/\s+/);
		if (/^[A-Za-z_]/.test(keyword)) {
			if (result != null) fail('Headers must precede LUT data.');
			if (headers.has(keyword)) fail(`Duplicate header: ${keyword}`);
			headers.add(keyword);
			switch (keyword) {
				case 'LUT_1D_SIZE': case 'LUT_3D_SIZE': {
					const maximum = keyword === 'LUT_1D_SIZE' ? MAX_1D_SIZE : MAX_3D_SIZE;
					if (tokens.length !== 1 || !/^\d+$/.test(tokens[0])) fail('LUT size must be an integer.');
					const size = Number(tokens[0]);
					if (size < 2 || size > maximum) fail(`${keyword} must be between 2 and ${maximum}.`);
					if (keyword === 'LUT_1D_SIZE') size1d = size; else size3d = size;
					break;
				}
				case 'DOMAIN_MIN': domainMin = numbers(tokens, 3) as LutDomain; break;
				case 'DOMAIN_MAX': domainMax = numbers(tokens, 3) as LutDomain; break;
				case 'LUT_1D_INPUT_RANGE': range1d = numbers(tokens, 2) as [number, number]; break;
				case 'LUT_3D_INPUT_RANGE': range3d = numbers(tokens, 2) as [number, number]; break;
				default: fail(`Unsupported header: ${keyword}`);
			}
			continue;
		}
		result ??= beginData();
		const values = numbers([keyword, ...tokens], 3);
		const target = row < size1d ? result.oneDimensional : result.threeDimensional;
		const offset = (row < size1d ? row : row - size1d) * 4;
		if (target == null || offset >= target.values.length) return fail('Too many LUT entries.');
		target.values.set([...values, 1], offset);
		row++;
	}
	result ??= beginData();
	if (row !== size1d + size3d ** 3) fail(`Expected ${size1d + size3d ** 3} LUT entries, found ${row}.`);
	return result;
}
