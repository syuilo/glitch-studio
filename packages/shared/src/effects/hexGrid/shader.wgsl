struct Uniforms {
	aspect: vec2f,
	sizeScale: vec2f,
	pixelSize: f32,
	lineWidth: f32,
	lineColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

fn hexEdgeDistance(position: vec2f) -> f32 {
	// 隣接中心間距離1の三角格子を、半周期ずらした二つの長方形格子で表す。
	// それぞれの最寄り中心を比較すれば、所属する六角セルが定まる。
	// floor(x + 0.5)を使うことで負の座標でも同じ周期で繰り返す。
	let period = vec2f(1.0, 1.7320508075688772);
	let offsetA = position - floor(position / period + vec2f(0.5)) * period;
	let shiftedPosition = position - period * 0.5;
	let offsetB = shiftedPosition - floor(shiftedPosition / period + vec2f(0.5)) * period;
	let localPosition = abs(select(offsetA, offsetB, dot(offsetB, offsetB) < dot(offsetA, offsetA)));
	// 六辺の単位法線への射影の最大値を、内接円半径0.5から引く。
	// 最寄りの辺までの距離なので、頂点でも線を重複して合成しない。
	return max(0.0, 0.5 - max(localPosition.x, dot(localPosition, vec2f(0.5, 0.8660254037844386))));
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 3.141592653589793;
	let inputSize = read_size(fragData.position);
	// Sizeが等しく、fitがcover/containなら正六角形になる。
	// Sizeは対辺間距離の基準倍率。0以下の軸だけ出力の1pxに置き換える。
	let size = select(min(inputSize, vec2f(1.0)) * uniforms.sizeScale, vec2f(uniforms.pixelSize), inputSize <= vec2f(0.0));
	let centeredPosition = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedPosition = vec2f(
		centeredPosition.x * cosine - centeredPosition.y * sine,
		centeredPosition.x * sine + centeredPosition.y * cosine,
	);
	// 線幅は六角セルの対辺間距離に対する割合で、Sizeと一緒に拡縮する。
	let edgeDistance = hexEdgeDistance(rotatedPosition / size);
	let isLine = uniforms.lineWidth > 0.0 && edgeDistance <= uniforms.lineWidth * 0.5;
	// セル内部はBackgroundをそのまま表示し、線の部分だけを着色する。
	let opacity = select(0.0, clamp(uniforms.lineColor.a, 0.0, 1.0), isLine);
	// 他のパターンと同じく背景のalphaを保持し、色のalphaを着色強度に使う。
	// 背景RGBは既にpremultipliedなので、定数色だけを背景alphaに合わせる。
	return vec4f(mix(backgroundColor.rgb, uniforms.lineColor.rgb * backgroundColor.a, opacity), backgroundColor.a);
}
