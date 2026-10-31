import type { ExpressionFunction } from './expression-environment.ts';

const UINT32_RANGE = 0x100000000;

// 乗算を32bit整数として行い、入力の上位・下位のbitを混ぜる。
// Math.sinなどの超越関数や乱数生成器の状態に依存せず、同じ引数から同じ値を求めるための処理。
function mixUint32(value: number): number {
	let mixed = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
	mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
	return (mixed ^ (mixed >>> 16)) >>> 0;
}

function hashSample(index: number, seed: number): number {
	// JSのbit演算だけでは安全な整数の上位bitが失われ、2^32離れた座標やseedが同じになる。
	// 符号付きの整数を下位32bitと残りの上位bitに分け、順序を保って両方を混ぜる。
	let hash = mixUint32(0x9e3779b9 ^ (index >>> 0));
	hash = mixUint32(hash ^ Math.floor(index / UINT32_RANGE));
	hash = mixUint32(hash ^ (seed >>> 0));
	return mixUint32(hash ^ Math.floor(seed / UINT32_RANGE));
}

function random(...args: unknown[]): number {
	const [index, seed = 0] = args;
	if (args.length < 1 || args.length > 2 || typeof index !== 'number' || !Number.isSafeInteger(index)
		|| typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
		throw new Error('RANDOM requires a safe integer index and an optional safe integer seed');
	}
	return hashSample(index, seed) / UINT32_RANGE;
}

function noise(...args: unknown[]): number {
	const [coordinate, seed = 0] = args;
	if (args.length < 1 || args.length > 2 || typeof coordinate !== 'number' || !Number.isFinite(coordinate)
		|| typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
		throw new Error('NOISE requires a finite coordinate and an optional safe integer seed');
	}
	const leftIndex = Math.floor(coordinate);
	const fraction = coordinate - leftIndex;
	// Gradient Noiseは格子点で0になる。安全な整数を超える有限値も、小数部を表せないのでここに含まれる。
	// 先に処理することで、その範囲で隣の格子点を計算したり、不正確な整数をhashへ渡したりしない。
	if (fraction === 0) return 0;

	// 隣り合う格子点に決定的な勾配を割り当て、各格子点からの距離との積を補間する1次元Perlin Noise。
	// 値自体を補間するValue Noiseと異なり、格子点を越えても勾配を保つので、そこで毎回停止しない。
	const leftGradient = hashSample(leftIndex, seed) / UINT32_RANGE * 2 - 1;
	const rightGradient = hashSample(leftIndex + 1, seed) / UINT32_RANGE * 2 - 1;
	// 5次の補間率は端点で1階・2階微分が0になるため、区間の境界でも滑らかに繋がる。
	const weight = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10);
	// 勾配の絶対値は1以下で、補間後の絶対値は最大1/2。2倍して出力を-1〜1に収める。
	return 2 * ((1 - weight) * leftGradient * fraction + weight * rightGradient * (fraction - 1));
}

// 時刻・プロパティ・呼び出し回数に依存しない共通関数。式エンジンへの公開はパラメータ評価器が行う。
export const randomExpressionFunctions: Readonly<Record<'RANDOM' | 'NOISE', ExpressionFunction>> = {
	RANDOM: random,
	NOISE: noise,
};
