export type CustomNodeGraphEffectWireStyle = 'straight' | 'curved';

type Position = readonly [number, number];

// 長い接続でたわみが過剰にならないよう、余長には割合と絶対値の両方で上限を設ける。
const slackRatio = 0.08;
const maxExtraLength = 32;
const approximationTolerance = 0.25;
const maxSubdivisionDepth = 10;

/**
 * Custom Node Graph Effect Editor内の座標から配線のSVGパスを作る。
 * ケーブル長は表示のためにその都度決め、プロジェクトや接続情報には保持しない。
 */
export function getCustomNodeGraphEffectWirePath(from: Position, to: Position, style: CustomNodeGraphEffectWireStyle): string {
	const straightPath = `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
	if (style === 'straight') return straightPath;

	const left = from[0] <= to[0] ? from : to;
	const right = from[0] <= to[0] ? to : from;
	const horizontalDistance = right[0] - left[0];
	const verticalDistance = right[1] - left[1];
	const distance = Math.hypot(horizontalDistance, verticalDistance);
	// 垂直なカテナリーは折り返して重なる極限形になる。画面で区別できない幅は直線にする。
	if (horizontalDistance < 0.01) return straightPath;

	const baseExtraLength = Math.min(distance * slackRatio, maxExtraLength);
	// 垂直に近づくほど余長を滑らかに減らし、ドラッグで左右が入れ替わっても跳ねないようにする。
	const extraLength = baseExtraLength * (horizontalDistance / distance) ** 2;
	// L = distance + extraLength, h = horizontalDistance, v = verticalDistance として、
	// sinh(u) / u = sqrt(L² - v²) / h、u = h / (2a) を解く。
	// 右辺は上の余長の定義で展開し、ほぼ垂直な接続でL² - v²の桁落ちを起こさないようにする。
	const lengthRatio = Math.sqrt(1 + (2 + extraLength / distance) * (baseExtraLength / distance));
	let lower = 0;
	// 余長は直線距離の8%以下なので右辺は1.08以下、sinh(1) > 1.08で解を挟める。
	let upper = 1;
	for (let iteration = 0; iteration < 40; iteration++) {
		const middle = (lower + upper) / 2;
		if (Math.sinh(middle) / middle < lengthRatio) {
			lower = middle;
		} else {
			upper = middle;
		}
	}
	const halfSpan = (lower + upper) / 2;
	const catenaryScale = horizontalDistance / (2 * halfSpan);
	const vertexOffset = halfSpan + Math.asinh(verticalDistance / (horizontalDistance * lengthRatio));

	function getY(horizontalOffset: number): number {
		const scaledOffset = horizontalOffset / (2 * catenaryScale);
		// 画面では下が+Y。coshの差をsinhの積へ変形し、張った曲線の桁落ちを避ける。
		return left[1] - 2 * catenaryScale * Math.sinh(scaledOffset) * Math.sinh(scaledOffset - vertexOffset);
	}

	const points: Position[] = [[0, left[1]]];

	function subdivide(start: Position, end: Position, depth: number): void {
		const slope = (end[1] - start[1]) / (end[0] - start[0]);
		// カテナリーと弦の差が最大になるのは接線の傾きが弦と一致する位置。
		// 中点だけの判定では非対称な曲線の大きな誤差を見落とすため、極値で判定する。
		const extremum = Math.max(start[0], Math.min(end[0], catenaryScale * (vertexOffset - Math.asinh(slope))));
		const error = getY(extremum) - (start[1] + slope * (extremum - start[0]));
		if (error > approximationTolerance && depth < maxSubdivisionDepth) {
			const middleX = (start[0] + end[0]) / 2;
			const middle: Position = [middleX, getY(middleX)];
			subdivide(start, middle, depth + 1);
			subdivide(middle, end, depth + 1);
		} else {
			points.push(end);
		}
	}

	// 端点は計算誤差でポートからずれないよう、入力された座標をそのまま使う。
	subdivide([0, left[1]], [horizontalDistance, right[1]], 0);
	if (from[0] > to[0]) points.reverse();
	return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${left[0] + point[0]} ${point[1]}`).join(' ');
}
