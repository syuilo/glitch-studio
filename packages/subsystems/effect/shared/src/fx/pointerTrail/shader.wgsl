struct Uniforms {
	aspectRatio: f32,
	timeDelta: f32,
	radius: f32,
	halfLife: f32,
	strength: f32,
	pointerPosition: vec2f,
	pointerVector: vec2f,
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

struct PointerTrailOutputs {
	@location(0) vector: vec2f,
	@location(1) scalar: f32,
};

fn scaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv / vec2f(1.0, aspectRatio) * select(1.0, aspectRatio, 1.0 > aspectRatio);
}

fn getPointerForceVector(uv: vec2f) -> vec2f {
	if (uniforms.pointerPosition.x <= -999.0 && uniforms.pointerPosition.y <= -999.0) {
		return vec2f(0.0);
	}

	var v = vec2f(0.0);
	let radius = uniforms.radius;

	let pos = scaleUvToCoverGivenAspectRatio(uniforms.pointerPosition, uniforms.aspectRatio);
	let d = distance(uv, pos);
	if (d < radius) {
		let gradate = 1.0 - (d / radius);
		v = (gradate * gradate) * (uniforms.pointerVector * 32.0);
	}

	return v;
}

@fragment
fn fs(fragData: FragmentIn) -> PointerTrailOutputs {
	let uv = scaleUvToCoverGivenAspectRatio(fragData.uv, uniforms.aspectRatio);
	// 履歴を補間で拡散させず、同じ画素に力を蓄積する。
	let previousVector = textureLoad(previousVectorTexture, vec2i(fragData.position.xy), 0).rg;
	let previousScalar = textureLoad(previousScalarTexture, vec2i(fragData.position.xy), 0).r;
	let decay = exp2(-uniforms.timeDelta / uniforms.halfLife);
	let pointerForceVector = getPointerForceVector(uv) * uniforms.strength;
	// scalarの強さは半径と同じ長辺基準の距離で測り、画面上で同じ距離の移動なら
	// 縦横どちらへ動かしても同じ量を加算する。vectorの出力座標系には依存させない。
	let pointerForceMagnitude = length(scaleUvToCoverGivenAspectRatio(pointerForceVector, uniforms.aspectRatio));
	// 蓄積済みベクトルの長さでは逆方向の動きが相殺されるため、
	// 各フレームで加える力の長さを独立した履歴へ蓄積して軌跡の強さを保つ。
	// vectorの座標系を切り替えたときは履歴も新しい単位へ換算し、
	// 既存の軌跡を維持しながら異なる単位の値を加算することを避ける。
	return PointerTrailOutputs(
		previousVector * uniforms.vectorHistoryScale * decay + pointerForceVector * uniforms.vectorOutputScale,
		previousScalar * decay + pointerForceMagnitude,
	);
}
