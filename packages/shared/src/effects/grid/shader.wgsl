struct Uniforms {
	aspect: vec2f,
	angle: f32,
	size: f32,
	majorWidth: f32,
	minorDivisions: f32,
	minorWidth: f32,
	majorColor: vec4f,
	minorColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

fn gridDistance(gridPosition: vec2f) -> f32 {
	// 負の座標でも同じ周期にし、最寄りの縦線・横線までの距離を求める。
	// 距離の最小値で判定するため、交差点でも二重に合成されない。
	let cellPosition = fract(gridPosition);
	let distanceToLine = min(cellPosition, vec2f(1.0) - cellPosition);
	return min(distanceToLine.x, distanceToLine.y);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	// 短辺全体が1となる中央原点の座標にし、縦横の線幅と間隔を揃える。
	let centeredPosition = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(uniforms.angle);
	let sine = sin(uniforms.angle);
	let rotatedPosition = vec2f(
		centeredPosition.x * cosine - centeredPosition.y * sine,
		centeredPosition.x * sine + centeredPosition.y * cosine,
	);
	var lineColor = vec4f(0.0);
	let gridPosition = rotatedPosition / uniforms.size;
	// 線幅はそれぞれの格子間隔に対する割合。格子座標のまま判定し、
	// sizeを下げると間隔と線幅が一緒に縮むようにする。
	if (gridDistance(gridPosition) < uniforms.majorWidth * 0.5) {
		lineColor = uniforms.majorColor;
	} else if (uniforms.minorDivisions > 0.0) {
		// 補助線は補助格子の間隔が基準なので、分割数にも線幅が連動する。
		if (gridDistance(gridPosition * uniforms.minorDivisions) < uniforms.minorWidth * 0.5) {
			// 主線が透明でも、その領域に補助線は重ねない。
			lineColor = uniforms.minorColor;
		}
	}

	// 入力alphaを維持し、線のalphaを着色の強度として使う。
	// 定数色だけを入力alphaに合わせ、premultipliedな入力RGBは再乗算しない。
	return vec4f(mix(backgroundColor.rgb, lineColor.rgb * backgroundColor.a, clamp(lineColor.a, 0.0, 1.0)), backgroundColor.a);
}
