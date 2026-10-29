// Adapted from Shader Effects Inc.'s Glass and gentpan's liquidglass (MIT); see LICENSE and README.md.
struct Uniforms {
	sdfScale: vec2f,
	gradientStep: vec2f,
	innerZoomCenter: vec2f,
	lightDirection: vec2f,
	highlightColor: vec4f,
	fresnelColor: vec4f,
	tintColor: vec4f,
	aspectRatio: f32,
	refraction: f32,
	thickness: f32,
	curvature: f32,
	ior: f32,
	edgeSoftness: f32,
	blur: f32,
	aberration: f32,
	innerZoom: f32,
	highlight: f32,
	highlightSoftness: f32,
	fresnel: f32,
	fresnelSoftness: f32,
	tintIntensity: f32,
	transparentSdf: u32,
	refractionModel: u32,
	tintPreserveLuminosity: u32,
	cutout: u32,
	blurSamples: u32,
	aberrationSamples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn distanceAt(position: vec2f) -> f32 {
	let distance = read_sdf(position);
	if (distance == 65504.0 || uniforms.transparentSdf == 0u) { return distance; }
	let extent = vec2f(uniforms.aspectRatio, 1.0) * 0.5;
	return max(distance, rectangleDistance(position * extent, extent / uniforms.sdfScale, 0.0));
}

fn distanceGradient(position: vec2f) -> vec2f {
	let step = uniforms.gradientStep;
	let horizontal = distanceAt(position + vec2f(step.x, 0.0)) - distanceAt(position - vec2f(step.x, 0.0));
	let vertical = distanceAt(position + vec2f(0.0, step.y)) - distanceAt(position - vec2f(0.0, step.y));
	// 中心差分の分母は2*step。画面座標から高さ基準へ変換する倍率2と相殺する。
	// 合成の継ぎ目・空形状との境界で過大な差分が出ても、屈折が画面全体へ飛ばないよう制限する。
	let gradient = clamp(vec2f(horizontal / (step.x * uniforms.aspectRatio), vertical / step.y), vec2f(-12.0), vec2f(12.0));
	return gradient * min(1.0, 12.0 / max(length(gradient), 0.0001));
}

fn refractionStrength(depth: f32) -> f32 {
	if (uniforms.thickness <= 0.0) { return 0.0; }
	let remaining = 1.0 - clamp(depth / uniforms.thickness, 0.0, 1.0);
	// 現行方式では計算順序を含めて二次減衰を維持し、Curvature・IORを参照しない。
	if (uniforms.refractionModel == 0u) { return remaining * remaining; }
	if (remaining <= 0.0 || uniforms.ior <= 1.0) { return 0.0; }

	// liquidglass.devと同じ断面 h(s) = (1 - (1 - s)^k)^(1/k) を使う。
	// sは輪郭からの深さ/Thickness、kはCurvature。直接h'(s)を計算すると
	// s=0の垂直な縁で無限大になるため、傾きの分子・分母から角度のsin/cosを求める。
	let k = uniforms.curvature;
	let slopeNumerator = pow(remaining, k - 1.0);
	let slopeDenominator = pow(max(1.0 - pow(remaining, k), 0.0), 1.0 - 1.0 / k);
	let inclination = normalize(vec2f(slopeNumerator, slopeDenominator));
	let sine = inclination.x;
	let cosine = inclination.y;

	// Snellの法則 thetaT = asin(sin(theta)/IOR) から tan(theta-thetaT) を求め、
	// 縁の最大値sqrt(IOR^2-1)で正規化する。Refractionの強さを両方式で揃えるため、
	// IORは減衰の形だけを変え、最大変位は変えない（IOR=1は屈折なし）。
	// 三角関数の差とIOR^2-1の桁落ちを避けるため、差を有理化した等価式を使う。
	let excess = (uniforms.ior - 1.0) * (uniforms.ior + 1.0);
	let transmittedCosine = sqrt(excess + cosine * cosine);
	let denominator = (transmittedCosine + cosine) * (cosine * transmittedCosine + sine * sine);
	return clamp(sine * sqrt(excess) / denominator, 0.0, 1.0);
}

fn lensSample(position: vec2f) -> vec4f {
	// 1点では円盤中心を読む。Vogel diskの最初の点をそのまま使うと、
	// 平均できないまま画像が片側へ移動するため、ぼかしなしと同じ参照位置にする。
	if (uniforms.blur <= 0.0 || uniforms.blurSamples <= 1u) { return read_input(position); }
	// 元実装のVogel disk方式を使用する。指定数の点を高さ基準の円盤へ配置し、
	// Gaussian重みを掛ける。初期値24では従来の点配置・計算順序を維持する。
	// 画素・時刻による乱数を使わず、再描画で揺れないようにする。
	var result = vec4f(0.0);
	var totalWeight = 0.0;
	let sampleCount = uniforms.blurSamples;
	for (var index = 0u; index < sampleCount; index++) {
		let radiusSquared = (f32(index) + 0.5) / f32(sampleCount);
		let angle = f32(index) * 2.399963229728653;
		let offset = vec2f(cos(angle) / uniforms.aspectRatio, sin(angle)) * sqrt(radiusSquared) * uniforms.blur * 2.0;
		let weight = exp(-radiusSquared * 4.0);
		// 乗算済みRGBAのまま平均し、透明画素の色が縁へ漏れることを防ぐ。
		result += read_input(position + offset) * weight;
		totalWeight += weight;
	}
	return result / totalWeight;
}

fn refractedSample(position: vec2f, offset: vec2f) -> vec4f {
	if (uniforms.aberration <= 0.0 || all(offset == vec2f(0.0))) { return lensSample(position); }
	let separation = offset * uniforms.aberration * 0.06;
	let sampleCount = uniforms.aberrationSamples;
	if (sampleCount <= 1u) {
		// 初期値では従来と同じRGB各1点を読み、低コストの色ずれも維持する。
		let green = lensSample(position);
		let red = lensSample(position + separation);
		let blue = lensSample(position - separation);
		return vec4f(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
	}
	var colorAccumulator = vec3f(0.0);
	var alphaAccumulator = vec3f(0.0);
	for (var index = 0u; index < sampleCount; index++) {
		// 各RGBの従来の参照位置を中心に、幅separationの区間を中点で積分する。
		// 区間を対称にして、点数を変えても各チャンネルの分散の中心を移動させない。
		let fraction = (f32(index) + 0.5) / f32(sampleCount) - 0.5;
		let subPosition = position + separation * fraction;
		let red = lensSample(subPosition + separation);
		let green = lensSample(subPosition);
		let blue = lensSample(subPosition - separation);
		colorAccumulator += vec3f(red.r, green.g, blue.b);
		alphaAccumulator += vec3f(red.a, green.a, blue.a);
	}
	// 色とalphaを同じ重みで平均してから、各チャンネルの最大alphaを採用する。
	// サンプル全体の最大alphaを直接使うと、透明境界の薄い色まで不透明になってしまう。
	let color = colorAccumulator / f32(sampleCount);
	let alpha = alphaAccumulator / f32(sampleCount);
	return vec4f(color, max(alpha.r, max(alpha.g, alpha.b)));
}

fn tint(rgb: vec3f) -> vec3f {
	let amount = uniforms.tintIntensity * clamp(uniforms.tintColor.a, 0.0, 1.0);
	var tinted = mix(rgb, uniforms.tintColor.rgb, amount);
	if (uniforms.tintPreserveLuminosity != 0u) {
		let weights = vec3f(0.299, 0.587, 0.114);
		tinted *= dot(rgb, weights) / max(dot(tinted, weights), 0.0001);
	}
	return tinted;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let distance = distanceAt(position);
	// 微分は画素値に依存する早期returnより前で計算する。
	let transitionWidth = max(uniforms.edgeSoftness, fwidth(distance));
	var coverage = select(0.0, 1.0, distance < 0.0);
	if (transitionWidth > 0.0) {
		coverage = 1.0 - smoothstep(-transitionWidth * 0.5, transitionWidth * 0.5, distance);
	}
	let base = read_input(position);
	if (distance == 65504.0 || coverage <= 0.0) {
		if (uniforms.cutout != 0u) { return vec4f(0.0); }
		return base;
	}
	let gradient = distanceGradient(position);
	let depth = max(-distance, 0.0);
	let refractionWeight = refractionStrength(depth);
	var refractionGradient = gradient;
	if (uniforms.refractionModel != 0u) {
		// 新方式では断面から変位の大きさを決めるため、SDFの勾配は方向だけに使う。
		// 勾配0では変位0とし、一様な距離場や形状の中心でnormalize(0)を行わない。
		refractionGradient /= max(length(gradient), 0.0001);
	}
	// 参照位置は[-1,+1]。高さ基準0.15を画面座標へ変換し、Xだけ縦横比を補正する。
	let offset = -refractionGradient * vec2f(1.0 / uniforms.aspectRatio, 1.0) * (uniforms.refraction * 0.3 * refractionWeight);
	let zoomed = uniforms.innerZoomCenter + (position - uniforms.innerZoomCenter) / uniforms.innerZoom;
	let lens = refractedSample(zoomed + offset, offset);
	var rgb = vec3f(0.0);
	if (lens.a > 0.0) { rgb = tint(lens.rgb / lens.a); }

	// 1画素の線を加える元実装と異なり、縁の幅も高さ基準で保持する。
	// 最小AA幅だけが画素に依存し、解像度を上げてもハイライトの明るさが減衰しない。
	let rimWidth = max(0.001 + uniforms.highlightSoftness * 0.004, transitionWidth);
	let rim = 1.0 - smoothstep(0.0, rimWidth, depth);
	let facing = clamp(dot(gradient, uniforms.lightDirection) * 0.5 + 0.5, 0.0, 1.0);
	let normal = normalize(vec3f(gradient, 2.0));
	let halfDirection = normalize(vec3f(uniforms.lightDirection, 2.0));
	let shininess = exp2(8.0 - uniforms.highlightSoftness * 7.0);
	let specular = pow(max(dot(normal, halfDirection), 0.0), shininess) * refractionWeight;
	let highlight = uniforms.highlight * (rim * facing + specular);
	let fresnelWidth = max(uniforms.fresnelSoftness * 0.06, 0.001);
	let fresnelWeight = 1.0 - clamp(depth / fresnelWidth, 0.0, 1.0);
	let fresnel = uniforms.fresnel * fresnelWeight * fresnelWeight;
	rgb += uniforms.highlightColor.rgb * uniforms.highlightColor.a * highlight;
	rgb += uniforms.fresnelColor.rgb * uniforms.fresnelColor.a * fresnel;
	// 着色・照明は屈折後のalpha内に適用する。合成も乗算済みRGBAで行い、
	// Cutoutは元画像を混ぜずに形状の被覆率を全成分へ掛ける。
	let lit = vec4f(rgb * lens.a, lens.a);
	if (uniforms.cutout != 0u) { return lit * coverage; }
	return mix(base, lit, coverage);
}
