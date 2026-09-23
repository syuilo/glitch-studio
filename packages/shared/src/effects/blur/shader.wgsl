// 0.0 ~ 1.0
fn rand(seed: vec2f) -> f32 {
	return fract(sin(dot(seed, vec2f(12.9898, 78.233))) * 43758.5453);
}

struct Uniforms {
	aspectRatio: f32,
	samples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const goldenAngle = 2.399963229728653; // radians

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	// 半径は出力画素の位置で読み、負値はぼかしなしとして扱う。
	// 片軸だけが0なら線状にぼかせるため、両軸が0のときだけ早期returnする。
	let radii = max(read_radius(fragData.uv), vec2f(0.0));
	if (all(radii <= vec2f(0.0))) {
		return read_input(fragData.uv);
	}

	// 角度は既存のangleコントロールと同じく1 = 180度。
	// +Yが上の座標系で時計回りに回すため符号を反転し、三角関数はループ外で計算する。
	let rotation = -read_rotation(fragData.uv) * 3.141592653589793;
	let cosine = cos(rotation);
	let sine = sin(rotation);
	// 縦横とも従来のAmountと同じ距離単位で伸縮・回転してから比率を補正する。
	// 比率補正を先に行うと、長方形の出力で回転時に楕円の形が歪んでしまう。
	let aspectCorrection = vec2f(1.0, uniforms.aspectRatio);
	let horizontalAxis = vec2f(cosine, sine) * radii.x * aspectCorrection;
	let verticalAxis = vec2f(-sine, cosine) * radii.y * aspectCorrection;

	var result = vec4f(0.0);
	var totalSamples = 0.0;
	let sampleCount = uniforms.samples;
	let jitter = rand(fragData.uv / vec2f(1.0, uniforms.aspectRatio)) * 4.0;

	for (var i: u32 = 0u; i < sampleCount; i++) {
		let radius = sqrt((f32(i) + 0.5) / f32(sampleCount));
		let theta = (f32(i) + jitter) * goldenAngle;
		let direction = vec2f(cos(theta), sin(theta));
		let offset = (horizontalAxis * direction.x + verticalAxis * direction.y) * radius;
		let weight = exp(-radius * radius * 4.0);
		let samplePosition = fragData.uv + offset;
		// 入力接続のfit/wrapは各サンプル位置に適用する。乗算済みRGBAをそのまま平均する。
		result += read_input(samplePosition) * weight;
		totalSamples += weight;
	}

	return result / totalSamples;
}
