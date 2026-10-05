struct Uniforms {
	position: vec2f,
	halfSize: vec2f,
	fillColor: vec4f,
	strokeColor: vec4f,
	rotation: f32,
	cornerRadius: f32,
	strokeInside: f32,
	strokeOutside: f32,
	aspectRatio: f32,
	pixelSize: f32,
	shapeType: u32,
	strokeProgress: f32,
	strokeStartPoint: vec2f,
	strokeStartTangent: vec2f,
	strokeEndPoint: vec2f,
	strokeEndTangent: vec2f,
	strokeStartAngle: f32,
	strokeSweepAngle: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct BoundaryPoint {
	distance: f32,
	point: vec2f,
};

fn rectangleDistance(point: vec2f, halfSize: vec2f, radius: f32) -> f32 {
	let q = abs(point) - halfSize + vec2f(radius);
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

// 楕円を正規化した円の距離を使うと、長軸・短軸で輪郭の太さが変わってしまう。
// 最近点の法線条件から求める単調な方程式を二分探索し、実際の距離を求める。
// 数学的背景: David Eberly, Distance from a Point to an Ellipse... (CC BY 4.0)
// https://www.geometrictools.com/Documentation/DistancePointEllipseEllipsoid.pdf
fn ellipseDistance(point: vec2f, halfSize: vec2f) -> BoundaryPoint {
	if (halfSize.x == halfSize.y) {
		let magnitude = length(point);
		if (magnitude == 0.0) { return BoundaryPoint(-halfSize.x, vec2f(0.0, halfSize.y)); }
		return BoundaryPoint(magnitude - halfSize.x, point * (halfSize.x / magnitude));
	}
	let swapAxes = halfSize.x < halfSize.y;
	let axes = select(halfSize, halfSize.yx, swapAxes);
	let p = select(abs(point), abs(point.yx), swapAxes) / axes.x;
	let minor = axes.y / axes.x;
	let minorSquared = minor * minor;
	let difference = (1.0 - minor) * (1.0 + minor);
	var closest: vec2f;
	if (p.y == 0.0) {
		// 軸上では探索区間の端が特異点になるため、解析的な最近点を使う。
		let x = min(p.x / difference, 1.0);
		closest = vec2f(x, minor * sqrt(max(0.0, 1.0 - x * x)));
	} else {
		// delta = lambda + minor^2 と置くことで、内側の点でも小さい分母を
		// 負数と正数の減算で作らずに済む。長軸を1に揃えて桁あふれも避ける。
		let numerator = vec2f(p.x, minor * p.y);
		var low = numerator.y;
		var high = minorSquared + length(numerator);
		for (var i = 0u; i < 32u; i++) {
			let middle = (low + high) * 0.5;
			let normalized = numerator / vec2f(middle + difference, middle);
			if (dot(normalized, normalized) > 1.0) { low = middle; } else { high = middle; }
		}
		let delta = (low + high) * 0.5;
		closest = vec2f(p.x / (delta + difference), minorSquared * p.y / delta);
	}
	let distance = length(closest - p) * axes.x;
	let normalizedPoint = p / vec2f(1.0, minor);
	let boundary = select(closest, closest.yx, swapAxes) * axes.x * select(vec2f(-1.0), vec2f(1.0), point >= vec2f(0.0));
	return BoundaryPoint(select(-distance, distance, dot(normalizedPoint, normalizedPoint) >= 1.0), boundary);
}

fn rectangleClosestPoint(point: vec2f) -> vec2f {
	let coreSize = uniforms.halfSize - vec2f(uniforms.cornerRadius);
	let center = clamp(point, -coreSize, coreSize);
	let offset = point - center;
	let magnitude = length(offset);
	if (magnitude > 0.0) { return center + offset * (uniforms.cornerRadius / magnitude); }
	let side = select(vec2f(-1.0), vec2f(1.0), point >= vec2f(0.0));
	let distances = uniforms.halfSize - abs(point);
	if (distances.x < distances.y) { return vec2f(side.x * uniforms.halfSize.x, point.y); }
	return vec2f(point.x, side.y * uniforms.halfSize.y);
}

fn capDistance(point: vec2f, endpoint: vec2f, tangent: vec2f) -> f32 {
	let normal = vec2f(-tangent.y, tangent.x);
	let offset = point - endpoint;
	let across = clamp(dot(offset, normal), -uniforms.strokeInside, uniforms.strokeOutside);
	return length(offset - normal * across);
}

fn strokeProgressCoverage(point: vec2f, boundary: vec2f) -> f32 {
	if (uniforms.strokeProgress <= 0.0) { return 0.0; }
	if (uniforms.strokeProgress >= 1.0) { return 1.0; }
	// 弧長で求めた両端点を角度へ写すのは「どちら側の区間か」の判定だけ。
	// 画素自身の偏角で切ると楕円や長方形の端が斜めになるため、最近傍の輪郭点を使う。
	let tau = 6.283185307179586;
	let angle = (atan2(boundary.x, boundary.y) - uniforms.strokeStartAngle + tau) % tau;
	var included = angle <= uniforms.strokeSweepAngle;
	// 角丸0の頂点では多数の画素が同じ最近点を持つ。端がその頂点なら接線に
	// 垂直な切り口で判定し、角全体を一度に半透明にすることを避ける。
	if (all(boundary == uniforms.strokeStartPoint)) { included = dot(point - boundary, uniforms.strokeStartTangent) >= 0.0; }
	if (all(boundary == uniforms.strokeEndPoint)) { included = dot(point - boundary, uniforms.strokeEndTangent) <= 0.0; }
	// 無限の直線までの距離では反対側の輪郭にも継ぎ目が出る。輪郭幅に収まる
	// 有限の切り口までの距離を使い、起点をまたぐ区間にも同じAAを適用する。
	let distance = min(capDistance(point, uniforms.strokeStartPoint, uniforms.strokeStartTangent), capDistance(point, uniforms.strokeEndPoint, uniforms.strokeEndTangent));
	return coverage(select(distance, -distance, included));
}

fn coverage(distance: f32) -> f32 {
	// 距離はScene高さ単位なので、1画素の幅を解像度から直接求められる。
	// 微分命令に依存しないため、形状から離れた画素は距離計算前に除外できる。
	return 1.0 - smoothstep(-uniforms.pixelSize * 0.5, uniforms.pixelSize * 0.5, distance);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (any(uniforms.halfSize <= vec2f(0.0))) { return vec4f(0.0); }
	// Positionだけは既存の画面座標（端が±1）。寸法・輪郭幅には縦横共通の
	// Scene高さ単位を使い、時計回りの回転を逆変換して形状の座標へ戻す。
	let translated = (position - uniforms.position) * vec2f(uniforms.aspectRatio, 1.0) * 0.5;
	let c = cos(uniforms.rotation);
	let s = sin(uniforms.rotation);
	let point = vec2f(c * translated.x - s * translated.y, s * translated.x + c * translated.y);
	if (any(abs(point) > uniforms.halfSize + vec2f(uniforms.strokeOutside + uniforms.pixelSize))) { return vec4f(0.0); }
	var fillCoverage: f32;
	var strokeCoverage: f32;
	var boundary: vec2f;
	if (uniforms.shapeType == 0u) {
		let nearest = ellipseDistance(point, uniforms.halfSize);
		boundary = nearest.point;
		fillCoverage = coverage(nearest.distance);
		strokeCoverage = coverage(nearest.distance - uniforms.strokeOutside) - coverage(nearest.distance + uniforms.strokeInside);
	} else {
		fillCoverage = coverage(rectangleDistance(point, uniforms.halfSize, uniforms.cornerRadius));
		// 角丸0では外周も直角のまま。距離の閾値だけを広げると、四隅が
		// 意図せず丸まるため、外周・内周の長方形をそれぞれ構築する。
		let outerRadius = select(0.0, uniforms.cornerRadius + uniforms.strokeOutside, uniforms.cornerRadius > 0.0);
		let outer = coverage(rectangleDistance(point, uniforms.halfSize + vec2f(uniforms.strokeOutside), outerRadius));
		let innerSize = uniforms.halfSize - vec2f(uniforms.strokeInside);
		var inner = 0.0;
		if (all(innerSize > vec2f(0.0))) {
			inner = coverage(rectangleDistance(point, innerSize, max(0.0, uniforms.cornerRadius - uniforms.strokeInside)));
		}
		strokeCoverage = outer - inner;
		if (uniforms.strokeProgress > 0.0 && uniforms.strokeProgress < 1.0 && strokeCoverage > 0.0) {
			boundary = rectangleClosestPoint(point);
		}
	}
	if (strokeCoverage > 0.0) { strokeCoverage *= strokeProgressCoverage(point, boundary); }
	let fillAlpha = uniforms.fillColor.a * fillCoverage;
	let strokeAlpha = uniforms.strokeColor.a * clamp(strokeCoverage, 0.0, 1.0);
	let fill = vec4f(uniforms.fillColor.rgb * fillAlpha, fillAlpha);
	let stroke = vec4f(uniforms.strokeColor.rgb * strokeAlpha, strokeAlpha);
	// 半透明の輪郭から塗りが透けるよう、輪郭を塗りの上へ通常合成する。
	return stroke + fill * (1.0 - strokeAlpha);
}
