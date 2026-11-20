struct Uniforms {
	spatialHalfExtent: vec2f,
	pixelStep: vec2f,
	complexCenter: vec2f,
	juliaConstant: vec2f,
	rotation: vec2f,
	trapRotation: vec2f,
	trapPosition: vec2f,
	trapSize: vec2f,
	complexScale: f32,
	bailoutRadius: f32,
	opacity: f32,
	iterationDecay: f32,
	firstIteration: u32,
	maximumIterations: u32,
	formula: u32,
	compositeMode: u32,
	antialiasing: u32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn rotateReference(point: vec2f, rotation: vec2f) -> vec2f {
	// 参照位置を反時計回りに回すと、表示される画像は時計回りに回る。1turn=1周。
	return vec2f(rotation.x * point.x - rotation.y * point.y, rotation.y * point.x + rotation.x * point.y);
}

fn sampleTrap(orbit: vec2f) -> vec4f {
	// 複素平面の長さ4を公開座標の長さ1へ換算する。表示側のZoomを変えても
	// トラップの位置・寸法は変えず、空間データとしての単位を固定する。
	let point = rotateReference(orbit * 0.25 - uniforms.trapPosition, uniforms.trapRotation);
	let sourcePosition = point * 2.0 / uniforms.trapSize;
	// トラップは有限な矩形。接続のclamp/repeatが範囲外まで画像を埋めると、
	// 最初の反復だけで画面全体が不透明になり、フラクタル状の繰り返しが消えてしまう。
	// 矩形内では接続のFit/Wrap/Filterをそのまま使い、定数色も同じ範囲に限定する。
	if (!all(abs(sourcePosition) <= vec2f(1.0))) { return vec4f(0.0); }
	return read_input(sourcePosition);
}

fn evaluateOrbit(position: vec2f) -> vec4f {
	if (uniforms.opacity == 0.0 || uniforms.firstIteration > uniforms.maximumIterations) { return vec4f(0.0); }
	let point = position * uniforms.spatialHalfExtent + read_coordinateOffset(position);
	let complexPoint = uniforms.complexCenter + rotateReference(point, uniforms.rotation) * uniforms.complexScale;
	var orbit = complexPoint;
	var constant = uniforms.juliaConstant;
	if (uniforms.formula == 1u) {
		orbit = vec2f(0.0);
		constant = complexPoint;
	}
	// |z|^2-|z|>|c|なら以後の絶対値は増え続ける。Julia Constantが大きくても、
	// 指定半径だけで一度外へ出た軌道を早すぎる発散と誤認しないよう下限を補正する。
	let escapeRadius = max(uniforms.bailoutRadius, 0.5 + sqrt(0.25 + length(constant)));
	var result = vec4f(0.0);
	var weight = uniforms.opacity;
	for (var iteration = 1u; iteration <= uniforms.maximumIterations; iteration++) {
		// f32の二乗がオーバーフローする前に打ち切る。NaNも比較がfalseとなるため除外する。
		// 指定できる通常のBailout Radiusは最大1e12なので、この値には到達しない。
		if (!all(abs(orbit) < vec2f(1e15))) { break; }
		orbit = vec2f(orbit.x * orbit.x - orbit.y * orbit.y, 2.0 * orbit.x * orbit.y) + constant;
		if (!all(abs(orbit) < vec2f(1e30))) { break; }
		if (iteration >= uniforms.firstIteration) {
			let sampled = sampleTrap(orbit) * weight;
			switch uniforms.compositeMode {
				case 1u: { result = sampled + result * (1.0 - sampled.a); }
				case 2u: {
					// 同じalphaなら早い反復を維持し、配色や反復数によって同順位を入れ替えない。
					if (sampled.a > result.a) { result = sampled; }
				}
				default: { result += sampled * (1.0 - result.a); }
			}
			// 入力は乗算済みRGBA。Opacity・DecayもRGBA全体へ一度だけ掛ける。
			weight *= uniforms.iterationDecay;
			// First On Topの完全不透明な結果と、重み0は以後の反復で変わらない。
			// Last On Topでは不透明でも後続の画像が置き換えるので打ち切らない。
			if (weight == 0.0 || (uniforms.compositeMode == 0u && result.a >= 1.0)) { break; }
		}
		// 発散した最終点も一度は画像へ照合する。以後は半径外なので反復を続けない。
		if (length(orbit) > escapeRadius) { break; }
	}
	return result;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (uniforms.antialiasing == 0u) { return evaluateOrbit(position); }
	// 固定4点をそれぞれ最後まで合成してから乗算済みRGBAを平均し、
	// 反復の異なる画像片同士の境界でも透明度を二重に掛けない。
	let offset = uniforms.pixelStep * 0.25;
	return (
		evaluateOrbit(position + vec2f(-offset.x, -offset.y)) +
		evaluateOrbit(position + vec2f(offset.x, -offset.y)) +
		evaluateOrbit(position + vec2f(-offset.x, offset.y)) +
		evaluateOrbit(position + vec2f(offset.x, offset.y))
	) * 0.25;
}
