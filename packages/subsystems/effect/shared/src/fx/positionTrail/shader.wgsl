struct Uniforms {
	aspectRatio: f32,
	timeDelta: f32,
	radius: f32,
	halfLife: f32,
	strength: f32,
	position: vec2f,
	positionDelta: vec2f,
	vectorOutputScale: vec2f,
	vectorHistoryScale: vec2f,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var previousVectorTexture: texture_2d<f32>;
@group(0) @binding(3) var previousScalarTexture: texture_2d<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
	@builtin(position) position: vec4f,
};

struct PositionTrailOutputs {
	@location(0) vector: vec2f,
	@location(1) scalar: f32,
};

fn scaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv / vec2f(1.0, aspectRatio) * select(1.0, aspectRatio, 1.0 > aspectRatio);
}

fn getPositionForceVector(uv: vec2f) -> vec2f {
	let position = scaleUvToCoverGivenAspectRatio(uniforms.position, uniforms.aspectRatio);
	let distanceFromPosition = distance(uv, position);
	// Radius=0では何も加算せず、中心でも0除算しない。
	if (distanceFromPosition >= uniforms.radius) {
		return vec2f(0.0);
	}
	let falloff = 1.0 - distanceFromPosition / uniforms.radius;
	return (falloff * falloff) * (uniforms.positionDelta * 32.0);
}

@fragment
fn fs(fragData: FragmentIn) -> PositionTrailOutputs {
	let uv = scaleUvToCoverGivenAspectRatio(fragData.uv, uniforms.aspectRatio);
	// 履歴を補間で拡散させず、同じ画素に力を蓄積する。
	let previousVector = textureLoad(previousVectorTexture, vec2i(fragData.position.xy), 0).rg;
	let previousScalar = textureLoad(previousScalarTexture, vec2i(fragData.position.xy), 0).r;
	let decay = exp2(-uniforms.timeDelta / uniforms.halfLife);
	let positionForceVector = getPositionForceVector(uv) * uniforms.strength;
	// scalarの強さは半径と同じ長辺基準で測り、縦横の移動距離を同じ単位で扱う。
	// vectorの出力座標系によってscalarの強さは変えない。
	let positionForceMagnitude = length(scaleUvToCoverGivenAspectRatio(positionForceVector, uniforms.aspectRatio));
	// 逆方向の動きで軌跡の強さが相殺されないよう、加算する力の長さを別の履歴へ蓄積する。
	// vectorの座標系を切り替えたときは既存の履歴も新しい単位へ換算する。
	return PositionTrailOutputs(
		previousVector * uniforms.vectorHistoryScale * decay + positionForceVector * uniforms.vectorOutputScale,
		previousScalar * decay + positionForceMagnitude,
	);
}
