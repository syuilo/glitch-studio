struct Uniforms {
	canvasSize: vec2f,
	imageHalfSize: vec2f,
	cutoutBounds: vec4f,
	codeSize: f32,
	quietZone: f32,
	cellPixels: f32,
	cellScale: f32,
	roundness: f32,
	finderFrameRoundness: f32,
	finderCenterRoundness: f32,
	cellShape: u32,
	finderFrameShape: u32,
	finderCenterShape: u32,
	connected: u32,
	antiAlias: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var qrCodeCells: texture_2d<u32>;

fn inCutout(cell: vec2i) -> bool {
	let point = vec2f(cell);
	return all(point >= uniforms.cutoutBounds.xy) && all(point < uniforms.cutoutBounds.zw);
}

fn readCell(cell: vec2i) -> vec2u {
	// textureLoadの範囲外アクセスの結果には依存しない。くり抜きも近傍判定に反映し、
	// 消えたセルへ角丸の接続や内角の補完が伸びてこないようにする。
	if (any(cell < vec2i(0)) || any(cell >= vec2i(i32(uniforms.codeSize))) || inCutout(cell)) { return vec2u(0u); }
	return textureLoad(qrCodeCells, cell, 0).rg;
}

fn roundedBoxDistance(point: vec2f, halfSize: f32, radius: f32) -> f32 {
	let delta = abs(point) - halfSize + radius;
	return length(max(delta, vec2f(0.0))) + min(max(delta.x, delta.y), 0.0) - radius;
}

fn shapeDistance(point: vec2f, halfSize: f32, shape: u32, radius: f32) -> f32 {
	if (shape == 2u) { return length(point) - halfSize; }
	if (shape == 3u) { return (abs(point.x) + abs(point.y) - halfSize) * 0.70710678118; }
	return roundedBoxDistance(point, halfSize, select(0.0, radius, shape == 1u));
}

fn connectionCellDark(cell: vec2i) -> bool {
	let value = readCell(cell);
	// 三隅は外枠・中心を別に描画するため、連結先にしない。
	return value.r != 0u && value.g == 0u;
}

fn diagonalConnectionFilled(point: vec2f, cell: vec2i, start: vec2i, end: vec2i, radius: f32) -> bool {
	let startCell = cell + start;
	let endCell = cell + end;
	if (!connectionCellDark(startCell) || !connectionCellDark(endCell)) { return false; }
	// 対角セルの中心を結ぶ最大1セル幅の線は、端点の2セルに加え、残りの2セルにもかかる。
	// 両端が領域外でも、このどちらかがくり抜きなら接続を作らない。描画後に矩形で削ると
	// 線の片側に切れ込みが生じるため、手前のセルの丸い端で接続を終了させる。
	if (inCutout(vec2i(startCell.x, endCell.y)) || inCutout(vec2i(endCell.x, startCell.y))) { return false; }
	let relative = point - vec2f(start);
	let direction = vec2f(end - start);
	let along = clamp(dot(relative, direction) / dot(direction, direction), 0.0, 1.0);
	return length(relative - direction * along) <= radius;
}

fn diagonalCellFilled(point: vec2f, cell: vec2i, dark: bool, radius: f32) -> bool {
	if (dark && length(point) <= radius) { return true; }
	let directionY = select(1, -1, uniforms.cellShape == 5u);
	let direction = vec2i(1, directionY);
	// 太さは最大1セル。現在のセルへ入り得る線分は、中心から前後へ伸びる2本と、
	// その両側を横切る2本だけ。明部セルでも評価し、対角セル間の白い隙間へ線を描く。
	// 端点や線分がくり抜きにかかる場合と、検出パターンへの連結は除き、孤立した暗部は円のまま残す。
	return diagonalConnectionFilled(point, cell, vec2i(0), direction, radius)
		|| diagonalConnectionFilled(point, cell, -direction, vec2i(0), radius)
		|| diagonalConnectionFilled(point, cell, vec2i(-1, 0), vec2i(0, directionY), radius)
		|| diagonalConnectionFilled(point, cell, vec2i(0, -directionY), vec2i(1, 0), radius);
}

fn cellFilled(point: vec2f, cell: vec2i, dark: bool) -> bool {
	let halfSize = uniforms.cellScale * 0.5;
	let radius = halfSize * uniforms.roundness;
	if (halfSize <= 0.0) { return false; }
	if (uniforms.cellShape >= 4u) { return diagonalCellFilled(point, cell, dark, halfSize); }
	// 縮小したマスは間に隙間があるため個別に丸める。連結角丸では実際に接するマスだけを扱う。
	if (uniforms.connected == 0u || uniforms.cellShape != 1u || uniforms.cellScale < 1.0) {
		return dark && shapeDistance(point, halfSize, uniforms.cellShape, radius) <= 0.0;
	}
	let direction = vec2i(select(-1, 1, point.x >= 0.0), select(-1, 1, point.y >= 0.0));
	let horizontal = connectionCellDark(cell + vec2i(direction.x, 0));
	let vertical = connectionCellDark(cell + vec2i(0, direction.y));
	if (dark) {
		// 連結辺の角は削らず、両隣が明部の凸角だけを丸める。
		return horizontal || vertical || roundedBoxDistance(point, 0.5, radius) <= 0.0;
	}
	// 明部セルの角も評価して凹角を埋める。斜めが明部なら対角の二つのマスを勝手につながない。
	if (!horizontal || !vertical || !connectionCellDark(cell + direction) || radius <= 0.0) { return false; }
	let cornerDistance = vec2f(0.5) - abs(point);
	return all(cornerDistance < vec2f(radius)) && length(vec2f(radius) - cornerDistance) >= radius;
}

// light / cells / finder frame / finder centerの被覆率。画面外は全成分0にする。
fn qrCodeWeights(point: vec2f) -> vec4f {
	let totalSize = uniforms.codeSize + uniforms.quietZone * 2.0;
	let outerPosition = point + totalSize * 0.5;
	if (any(outerPosition < vec2f(0.0)) || any(outerPosition >= vec2f(totalSize))) { return vec4f(0.0); }
	let bodyPosition = outerPosition - uniforms.quietZone;
	if (any(bodyPosition < vec2f(0.0)) || any(bodyPosition >= vec2f(uniforms.codeSize))) { return vec4f(1.0, 0.0, 0.0, 0.0); }
	let cell = vec2i(floor(bodyPosition));
	if (inCutout(cell)) { return vec4f(1.0, 0.0, 0.0, 0.0); }
	let value = readCell(cell);
	if (value.g == 1u) {
		let finderCenter = vec2f(select(3.5, uniforms.codeSize - 3.5, bodyPosition.x >= uniforms.codeSize - 7.0), select(3.5, uniforms.codeSize - 3.5, bodyPosition.y >= uniforms.codeSize - 7.0));
		let local = bodyPosition - finderCenter;
		let outerRadius = uniforms.finderFrameRoundness * 3.5;
		let outerDistance = shapeDistance(local, 3.5, uniforms.finderFrameShape, outerRadius);
		// 角丸四角の内枠は外枠から1マス内側のオフセット。枠の太さを保つ。
		let innerDistance = shapeDistance(local, 2.5, uniforms.finderFrameShape, max(0.0, outerRadius - 1.0));
		if (outerDistance <= 0.0 && innerDistance > 0.0) { return vec4f(0.0, 0.0, 1.0, 0.0); }
		if (shapeDistance(local, 1.5, uniforms.finderCenterShape, uniforms.finderCenterRoundness * 1.5) <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
		return vec4f(1.0, 0.0, 0.0, 0.0);
	}
	// 検出パターン以外は、位置合わせ・タイミング・形式情報を含めて同じ設定で描く。
	let filled = cellFilled(fract(bodyPosition) - 0.5, cell, value.r != 0u);
	return select(vec4f(1.0, 0.0, 0.0, 0.0), vec4f(0.0, 1.0, 0.0, 0.0), filled);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (uniforms.codeSize <= 0.0 || uniforms.cellPixels <= 0.0) { return vec4f(0.0); }
	// QRコードのマスを座標単位にする。X/Yに同じピクセル寸法を使い、非正方形の出力でも歪ませない。
	let point = position * vec2f(0.5, -0.5) * uniforms.canvasSize / uniforms.cellPixels;
	var weights = qrCodeWeights(point);
	if (uniforms.antiAlias != 0u) {
		// セルごとのSDFに単独でAAを掛けると、隣接する暗部の境界に明るい継ぎ目が生じる。
		// 最終形状を2×2で被覆評価し、連結部・枠・くり抜き境界も同じ方法で扱う。
		let delta = 0.25 / uniforms.cellPixels;
		weights = (qrCodeWeights(point + vec2f(-delta, -delta)) + qrCodeWeights(point + vec2f(delta, -delta)) + qrCodeWeights(point + vec2f(-delta, delta)) + qrCodeWeights(point + vec2f(delta, delta))) * 0.25;
	}
	let light = read_lightColor(position);
	var color = light * weights.x + read_darkColor(position) * weights.y + read_finderFrameColor(position) * weights.z + read_finderCenterColor(position) * weights.w;
	if (all(uniforms.imageHalfSize > vec2f(0.0))) {
		let pixel = 1.0 / uniforms.cellPixels;
		let imageCoverage = clamp((uniforms.imageHalfSize - abs(point)) / pixel + 0.5, vec2f(0.0), vec2f(1.0));
		let inside = select(select(0.0, 1.0, all(abs(point) < uniforms.imageHalfSize)), imageCoverage.x * imageCoverage.y, uniforms.antiAlias != 0u);
		let imagePosition = point / uniforms.imageHalfSize * vec2f(1.0, -1.0);
		let image = read_centerImage(imagePosition) * inside;
		// 入力はすでに乗算済み。透明部分からQRコードを復活させず、くり抜いた明部色を下地にする。
		color = image + color * (1.0 - image.a);
	}
	return color;
}
