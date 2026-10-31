struct Uniforms {
	aspect: vec2f,
	cellSize: f32,
	maximumMagnitude: f32,
	lineWidth: f32,
	directionSpace: u32,
	gridWidth: f32,
	padding: u32,
	overflowColor: vec4f,
	zeroColor: vec4f,
	gridColor: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn segmentDistance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
	let segment = end - start;
	let squaredLength = dot(segment, segment);
	// ゼロベクトルの線分は点として扱う。極小の非ゼロ線分も、固定epsilonで長さを変えない。
	if (squaredLength == 0.0) { return length(point - start); }
	let amount = clamp(dot(point - start, segment) / squaredLength, 0.0, 1.0);
	return length(point - start - segment * amount);
}

fn premultiplyColor(color: vec4f) -> vec4f {
	let alpha = clamp(color.a, 0.0, 1.0);
	return vec4f(color.rgb * alpha, alpha);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 短辺全体が1となる座標で配置と距離を計算し、解像度・縦横比によるセルや線の歪みを防ぐ。
	let point = position * 0.5 * uniforms.aspect;
	let antialias = max(fwidth(point.x), fwidth(point.y)) * 0.5;
	let cellCenter = floor(point / uniforms.cellSize + 0.5) * uniforms.cellSize;
	let localPoint = point - cellCenter;
	let vector = read_vector(cellCenter / uniforms.aspect * 2.0);
	var ratio = 0.0;
	var overflow = false;
	var direction = vec2f(1.0, 0.0);
	let componentScale = max(abs(vector.x), abs(vector.y));
	if (componentScale > 0.0) {
		// 直接length(vector)を求めると二乗でオーバーフローし得る。
		// 先に最大成分で縮め、上限と比較してから0〜1の比率を求める。
		let scaledVector = vector / componentScale;
		let maximumScale = uniforms.maximumMagnitude / length(scaledVector);
		overflow = componentScale > maximumScale;
		ratio = min(componentScale, maximumScale) / maximumScale;
		var displayVector = scaledVector;
		if (uniforms.directionSpace == 1u) { displayVector *= uniforms.aspect; }
		direction = normalize(displayVector);
	}
	var arrowColor = vec4f(0.0);
	if (uniforms.lineWidth > 0.0) {
		let width = uniforms.lineWidth * uniforms.cellSize;
		// 線の丸い端まで含めた外形をセル幅の80%以内にし、どの方向でも隣のセルへ出さない。
		let arrowLength = max(0.0, uniforms.cellSize * 0.8 - width) * ratio;
		let start = -direction * arrowLength * 0.5;
		let end = direction * arrowLength * 0.5;
		let perpendicular = vec2f(-direction.y, direction.x);
		let headLength = arrowLength * 0.3;
		let headBase = end - direction * headLength;
		// 矢尻もベクトルの大きさに比例させ、小さい値を固定サイズの矢尻で誇張しない。
		var distance = segmentDistance(localPoint, start, end);
		distance = min(distance, segmentDistance(localPoint, headBase + perpendicular * headLength * 0.6, end));
		distance = min(distance, segmentDistance(localPoint, headBase - perpendicular * headLength * 0.6, end));
		let coverage = 1.0 - smoothstep(-antialias, antialias, distance - width * 0.5);
		var color = evaluateColorRamp(ratio);
		// 表示上は点へ縮む微小な非ゼロ値もRampを使い、入力が厳密に(0, 0)のときだけ専用色にする。
		if (componentScale == 0.0) {
			color = premultiplyColor(uniforms.zeroColor);
		} else if (overflow) {
			color = premultiplyColor(uniforms.overflowColor);
		}
		// Rampは既に乗算済みなので、RGBA全体に画素の被覆率だけを掛ける。
		arrowColor = color * coverage;
	}
	var gridColor = vec4f(0.0);
	if (uniforms.gridWidth > 0.0) {
		let edgeDistance = uniforms.cellSize * 0.5 - max(abs(localPoint.x), abs(localPoint.y));
		let coverage = 1.0 - smoothstep(-antialias, antialias, edgeDistance - uniforms.cellSize * uniforms.gridWidth * 0.5);
		gridColor = premultiplyColor(uniforms.gridColor) * coverage;
	}
	return arrowColor + gridColor * (1.0 - arrowColor.a);
}
