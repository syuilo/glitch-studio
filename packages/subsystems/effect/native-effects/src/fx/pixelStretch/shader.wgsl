struct Uniforms {
	halfExtent: vec2f,
	sampleLimit: vec2f,
	boundaryNormal: vec2f,
	boundaryAnchor: vec2f,
	tangentRange: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let relativePosition = position * uniforms.halfExtent - uniforms.boundaryAnchor;
	var samplePosition = position;
	if (dot(relativePosition, uniforms.boundaryNormal) < 0.0) {
		let tangent = vec2f(-uniforms.boundaryNormal.y, uniforms.boundaryNormal.x);
		let distance = clamp(dot(relativePosition, tangent), uniforms.tangentRange.x, uniforms.tangentRange.y);
		let boundaryPosition = (uniforms.boundaryAnchor + distance * tangent) / uniforms.halfExtent;
		// 画面端では最外周の画素中心を参照し、境界の端点に画面上で見えている色を使う。
		samplePosition = clamp(boundaryPosition, -uniforms.sampleLimit, uniforms.sampleLimit);
	}
	return read_input(samplePosition);
}
