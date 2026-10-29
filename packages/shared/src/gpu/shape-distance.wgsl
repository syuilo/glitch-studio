// 配置先・描画方式から独立した、2次元形状の境界への距離計算。
// halfSizeは両成分とも正、radiusは0〜halfSizeの短辺までに補正して渡す。
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
		if (numerator.x < difference) {
			// 長軸付近の内点では解deltaもp.yに比例して小さくなる。固定の広い
			// 区間を二分すると、回転・解像度変更で生じる微小なp.yを解けず距離が跳ぶ。
			// 第1項の分母delta+differenceをdifferenceに置き換えた式から
			// 解の上限を求め、区間幅をp.yに合わせる。1-x^2は差と和に分ける。
			let x = numerator.x / difference;
			high = min(high, numerator.y / sqrt((1.0 - x) * (1.0 + x)));
		}
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
