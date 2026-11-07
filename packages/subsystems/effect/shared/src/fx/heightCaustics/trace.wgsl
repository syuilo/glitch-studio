@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let height = readGradient_height(position, true);
	let slope = height.yz / uniforms.halfExtent * uniforms.heightScale;
	// 高さとXYはともに長辺全体=1。極端な傾斜でも正規化の二乗をoverflowさせない。
	let normalScale = max(1.0, max(abs(slope.x), abs(slope.y)));
	let normal = normalize(vec3f(-slope / normalScale, 1.0 / normalScale));
	let incidence = dot(normal, uniforms.lightDirection);
	let distance = uniforms.receiverDistance + height.x * uniforms.heightScale;
	if (incidence <= 0.0 || distance < 0.0) { return vec4f(0.0); }
	let transmitted = refract(-uniforms.lightDirection, normal, 1.0 / uniforms.ior);
	// 受光面より上にある面から、下向きに届く光だけを扱う。
	if (transmitted.z >= -1e-6) { return vec4f(0.0); }
	let destination = position * uniforms.halfExtent + transmitted.xy * (distance / -transmitted.z);
	// サンプルは表面積でなくXY上に等間隔。入射光の投影面積を法線のZで割り、
	// 斜面でも単なるサンプル数を光量と誤認しないようにする。
	let flux = min(incidence / normal.z, 65504.0);
	return vec4f(destination, flux, 1.0);
}
