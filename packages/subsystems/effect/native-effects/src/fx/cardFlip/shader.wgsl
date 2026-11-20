struct Uniforms {
	halfExtent: vec2f,
	axis: vec2f,
	pixelSize: f32,
	perspective: f32,
	shading: f32,
	texturedA: u32,
	texturedB: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var faceSampler: sampler;
@group(0) @binding(2) var faceA: texture_2d<f32>;
@group(0) @binding(3) var faceB: texture_2d<f32>;
const PI: f32 = 3.141592653589793;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let background = read_background(position);
	// 厚みのない板なので真横の面積は0。cos(PI/2)の丸め誤差で線を残さない。
	if (progress == 0.5) { return background; }
	let cosine = sin((0.5 - progress) * PI);
	let sine = cos((0.5 - progress) * PI);
	let axis = uniforms.axis;
	let perpendicular = vec2f(-axis.y, axis.x);
	let halfLength = dot(abs(axis), uniforms.halfExtent);
	let halfHeight = dot(abs(perpendicular), uniforms.halfExtent);
	let spatialPosition = position * uniforms.halfExtent;
	let coordinate = dot(spatialPosition, axis);
	let crossCoordinate = dot(spatialPosition, perpendicular);
	let pixelSize = uniforms.pixelSize;
	let depth = uniforms.perspective * sine;
	// 材料座標(u,v)を x=u*cos(theta)/(1-k*u*sin(theta)), y=v/(1-k*u*sin(theta))
	// へ投影する。k<=1、|u|<=0.5なのでカメラ面を横切らず、逆参照は常に有限。
	let ends = vec2f(-halfLength, halfLength) * cosine / (vec2f(1.0) - depth * vec2f(-halfLength, halfLength));
	let start = max(coordinate - pixelSize * 0.5, min(ends.x, ends.y));
	let end = min(coordinate + pixelSize * 0.5, max(ends.x, ends.y));
	if (end <= start) { return background; }

	// 回転軸と直交する幅は解析的に切り出す。1pxより細くても面積が連続して0へ近づく。
	// 残る斜辺は4区間で積分し、被覆部分の重心を求める。画素中心が板の外でも、
	// 外側のUVを読むことなく端の色でアンチエイリアスできる。
	var coverage = 0.0;
	var centroid = vec2f(0.0);
	for (var index = 0u; index < 4u; index++) {
		let x = mix(start, end, (f32(index) + 0.5) * 0.25);
		let projectedHeight = halfHeight * (1.0 + depth * x / cosine);
		let lower = max(crossCoordinate - pixelSize * 0.5, -projectedHeight);
		let upper = min(crossCoordinate + pixelSize * 0.5, projectedHeight);
		let weight = max(0.0, upper - lower) / pixelSize * (end - start) / pixelSize * 0.25;
		coverage += weight;
		centroid += vec2f(x, (lower + upper) * 0.5) * weight;
	}
	if (coverage <= 0.0) { return background; }
	centroid /= coverage;
	let inverseScale = 1.0 / (1.0 + depth * centroid.x / cosine);
	let materialCoordinate = centroid.x * inverseScale / cosine;
	let materialCrossCoordinate = centroid.y * inverseScale;
	// Bは「終了時に見せたい向き」で指定する。板の裏側の材料軸を打ち消して貼る。
	let backSign = select(1.0, -1.0, progress > 0.5);
	let material = axis * (materialCoordinate * backSign) + perpendicular * materialCrossCoordinate;
	let uvScale = vec2f(0.5, -0.5) / uniforms.halfExtent;
	let uv = clamp(material * uvScale + 0.5, vec2f(0.0), vec2f(1.0));
	// 逆投影の解析微分を渡す。単なるLOD 0の点参照では真横に近づくほど細部が
	// 激しくちらつくため、縮小画像と異方性フィルタで画素の足跡を平均する。
	let derivativeAlong = (axis * backSign - perpendicular * (centroid.y * depth)) * (inverseScale * inverseScale / cosine);
	let derivativeAcross = perpendicular * inverseScale;
	let gradientAlong = derivativeAlong * uvScale * (end - start);
	let gradientAcross = derivativeAcross * uvScale * pixelSize;
	var color: vec4f;
	if (progress < 0.5) {
		if (uniforms.texturedA != 0u) { color = textureSampleGrad(faceA, faceSampler, uv, gradientAlong, gradientAcross); }
		else { color = read_inputA(position); }
	} else {
		if (uniforms.texturedB != 0u) { color = textureSampleGrad(faceB, faceSampler, uv, gradientAlong, gradientAcross); }
		else { color = read_inputB(position); }
	}
	// 正面光＋環境光。RGBAの置換率と陰影を分離し、alphaやHDRの符号を保つ。
	color = vec4f(color.rgb * (1.0 - uniforms.shading * 0.45 * (1.0 - abs(cosine))), color.a);
	return mix(background, color, clamp(coverage, 0.0, 1.0));
}
