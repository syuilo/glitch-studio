import type { EvaluatedShape } from '@gs/subsystems_timeline_shared/shape.ts';

type StrokeEndpoint = { point: [number, number]; tangent: [number, number] };

/** 上中央から時計回りに、元の輪郭の長さに沿って進んだ端点と単位接線を求める。 */
export function getShapeStrokeEndpoint(shape: EvaluatedShape, progress: number): StrokeEndpoint {
	const [width, height] = shape.size.map(value => value / 2);
	if (width <= 0 || height <= 0 || progress <= 0 || progress >= 1) {
		return { point: [0, height], tangent: [1, 0] };
	}
	// 対称性から第一象限だけを計算する。奇数象限では同じ経路を逆順に辿る。
	// これにより0.25・0.5・0.75は数値積分の誤差によらず辺の中央に一致する。
	const quarterProgress = progress * 4;
	const quadrant = Math.floor(quarterProgress);
	const fraction = quadrant % 2 === 0 ? quarterProgress - quadrant : 1 - (quarterProgress - quadrant);
	let endpoint: StrokeEndpoint;
	if (shape.type === 'ellipse') {
		const angle = ellipseAngleAtLength(width, height, fraction);
		const tangent: [number, number] = [width * Math.cos(angle), -height * Math.sin(angle)];
		const length = Math.hypot(...tangent);
		endpoint = { point: [width * Math.sin(angle), height * Math.cos(angle)], tangent: [tangent[0] / length, tangent[1] / length] };
	} else {
		const radius = shape.cornerRadius;
		const horizontal = width - radius;
		const vertical = height - radius;
		const arc = Math.PI * radius / 2;
		const distance = fraction * (horizontal + arc + vertical);
		if (distance <= horizontal) {
			endpoint = { point: [distance, height], tangent: [1, 0] };
		} else if (radius > 0 && distance < horizontal + arc) {
			const angle = (distance - horizontal) / radius;
			endpoint = { point: [horizontal + radius * Math.sin(angle), vertical + radius * Math.cos(angle)], tangent: [Math.cos(angle), -Math.sin(angle)] };
		} else {
			endpoint = { point: [width, vertical - (distance - horizontal - arc)], tangent: [0, -1] };
		}
	}
	const signX = quadrant < 2 ? 1 : -1;
	const signY = quadrant === 0 || quadrant === 3 ? 1 : -1;
	const direction = quadrant % 2 === 0 ? 1 : -1;
	return {
		point: [endpoint.point[0] * signX, endpoint.point[1] * signY],
		tangent: [endpoint.tangent[0] * signX * direction, endpoint.tangent[1] * signY * direction],
	};
}

function ellipseAngleAtLength(width: number, height: number, fraction: number): number {
	if (fraction <= 0) return 0;
	if (fraction >= 1) return Math.PI / 2;
	if (width === height) return fraction * Math.PI / 2;
	// 楕円の角度と弧長は比例しない。画素ごとに積分する代わりに、描画前に一度だけ
	// 四分周の弧長表を作る。微小区間の中点速度による積分で、細長い楕円も扱う。
	// 寸法を正規化して二乗による桁あふれを避け、積分はJSの倍精度で行う。
	const scale = Math.max(width, height);
	const horizontal = width / scale;
	const vertical = height / scale;
	const steps = 512;
	const step = Math.PI / (2 * steps);
	const lengths = new Float64Array(steps + 1);
	for (let index = 0; index < steps; index++) {
		const angle = (index + 0.5) * step;
		lengths[index + 1] = lengths[index] + Math.hypot(horizontal * Math.cos(angle), vertical * Math.sin(angle)) * step;
	}
	const target = lengths[steps] * fraction;
	let index = 0;
	while (index < steps - 1 && lengths[index + 1] < target) index++;
	return (index + (target - lengths[index]) / (lengths[index + 1] - lengths[index])) * step;
}
