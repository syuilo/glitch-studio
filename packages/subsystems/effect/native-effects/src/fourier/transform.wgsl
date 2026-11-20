@group(0) @binding(0) var<uniform> transformUniforms: FourierTransformUniforms;
@group(0) @binding(1) var<storage, read> source: array<ComplexColor>;
@group(0) @binding(2) var<storage, read_write> destination: array<ComplexColor>;

@compute @workgroup_size(8, 8)
fn transform(@builtin(global_invocation_id) invocation: vec3u) {
	let point = invocation.xy;
	if (any(point >= transformUniforms.transformSize)) { return; }
	let coordinate = point[transformUniforms.axis];
	let halfSpan = transformUniforms.span / 2u;
	let withinSpan = coordinate % transformUniforms.span;
	let butterflyPosition = withinSpan % halfSpan;
	var first = point;
	first[transformUniforms.axis] = coordinate - withinSpan + butterflyPosition;
	var second = first;
	second[transformUniforms.axis] += halfSpan;
	let firstValue = source[fourierSampleOffset(first, invocation.z, transformUniforms.transformSize)];
	let secondValue = source[fourierSampleOffset(second, invocation.z, transformUniforms.transformSize)];
	let angle = select(-1.0, 1.0, transformUniforms.inverse != 0u) * fourierTau * f32(butterflyPosition) / f32(transformUniforms.span);
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedReal = secondValue.real * cosine - secondValue.imaginary * sine;
	let rotatedImaginary = secondValue.real * sine + secondValue.imaginary * cosine;
	let sign = select(1.0, -1.0, withinSpan >= halfSpan);
	// 逆変換は各段で1/2に正規化し、最終的に1/(幅×高さ)になる。
	let scale = select(1.0, 0.5, transformUniforms.inverse != 0u);
	destination[fourierSampleOffset(point, invocation.z, transformUniforms.transformSize)] = ComplexColor(
		(firstValue.real + rotatedReal * sign) * scale,
		(firstValue.imaginary + rotatedImaginary * sign) * scale,
	);
}
