@group(0) @binding(1) var<storage, read> points: array<PointState>;
@group(0) @binding(2) var<storage, read> neighbors: array<Neighbors>;

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) local: vec2f,
	@location(1) color: vec4f,
	@location(2) cameraDepth: f32,
};

fn hidden() -> VertexOutput {
	var result: VertexOutput;
	result.position = vec4f(0.0, 0.0, 2.0, 1.0);
	return result;
}

fn cameraPosition(position: vec3f) -> vec3f {
	let offset = rotate(position) + uniforms.translation - uniforms.cameraPosition;
	return vec3f(dot(offset, uniforms.cameraRight), dot(offset, uniforms.cameraUp), dot(offset, uniforms.cameraForward));
}

fn project(position: vec3f) -> vec4f {
	let far = 1000.0;
	if (uniforms.perspective != 0u) {
		return vec4f(position.xy * uniforms.projectionScale / uniforms.halfExtent,
			far * (position.z - uniforms.nearClip) / (far - uniforms.nearClip), position.z);
	}
	return vec4f(position.xy * uniforms.projectionScale / uniforms.halfExtent,
		(position.z - uniforms.nearClip) / (far - uniforms.nearClip), 1.0);
}

fn hasNeighbor(index: u32, candidate: u32) -> bool {
	for (var slot = 0u; slot < uniforms.maximumConnections; slot++) {
		if (neighbors[index].indices[slot] == candidate) { return true; }
	}
	return false;
}

fn quadCorner(vertex: u32) -> vec2f {
	let corners = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
	return corners[vertex];
}

fn widthScale(clip: vec4f) -> f32 {
	// 画面基準は透視除算を打ち消し、3D基準は位置と同じ投影倍率を使う。
	// 両者ともカメラ向きの円/帯なので、球や円柱のメッシュを増やす必要はない。
	return select(clip.w, uniforms.projectionScale, uniforms.worldSize != 0u);
}

@vertex
fn pointVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOutput {
	let position = cameraPosition(points[index].position.xyz);
	if (position.z < uniforms.nearClip) { return hidden(); }
	let corner = quadCorner(vertex);
	var clip = project(position);
	clip = vec4f(clip.xy + corner * uniforms.pointSize * 0.5 * widthScale(clip) / uniforms.halfExtent, clip.zw);
	return VertexOutput(clip, corner, uniforms.pointColor, position.z);
}

@vertex
fn lineVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
	let index = instance / uniforms.maximumConnections;
	let other = neighbors[index].indices[instance % uniforms.maximumConnections];
	// 相互近傍だけを結び、低い点IDだけが辺を描く。接続数の上限と一度だけの加算を保証する。
	if (other >= uniforms.pointCount || other <= index) { return hidden(); }
	if (!hasNeighbor(other, index)) { return hidden(); }
	var a = cameraPosition(points[index].position.xyz);
	var b = cameraPosition(points[other].position.xyz);
	if (max(a.z, b.z) < uniforms.nearClip) { return hidden(); }
	// 線の帯は投影後に方向を求めるため、透視除算より先にNear面で切る。
	// カメラの背後にある端点を除算すると、線が反転して画面全体へ伸びてしまう。
	if (a.z < uniforms.nearClip) { a = mix(a, b, (uniforms.nearClip - a.z) / (b.z - a.z)); }
	if (b.z < uniforms.nearClip) { b = mix(b, a, (uniforms.nearClip - b.z) / (a.z - b.z)); }
	let clipA = project(a);
	let clipB = project(b);
	let direction = (clipB.xy / clipB.w - clipA.xy / clipA.w) * uniforms.halfExtent;
	let lengthSquared = dot(direction, direction);
	if (lengthSquared < 1e-16) { return hidden(); }
	let normal = vec2f(-direction.y, direction.x) * inverseSqrt(lengthSquared);
	let corner = quadCorner(vertex);
	var clip = select(clipA, clipB, corner.x > 0.0);
	clip = vec4f(clip.xy + normal * corner.y * uniforms.lineWidth * 0.5 * widthScale(clip) / uniforms.halfExtent, clip.zw);
	let opacity = edgeOpacity(points[index], points[other]);
	let color = vec4f(uniforms.lineColor.rgb, uniforms.lineColor.a * opacity);
	return VertexOutput(clip, corner, color, select(a.z, b.z, corner.x > 0.0));
}

@vertex
fn faceVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
	let pairs = uniforms.maximumConnections * (uniforms.maximumConnections - 1u) / 2u;
	let index = instance / pairs;
	var pair = instance % pairs;
	var firstSlot = 0u;
	loop {
		let rowLength = uniforms.maximumConnections - firstSlot - 1u;
		if (pair < rowLength) { break; }
		pair -= rowLength;
		firstSlot += 1u;
	}
	let secondSlot = firstSlot + pair + 1u;
	let first = neighbors[index].indices[firstSlot];
	let second = neighbors[index].indices[secondSlot];
	if (first >= uniforms.pointCount || second >= uniforms.pointCount || first <= index || second <= index) { return hidden(); }
	if (!hasNeighbor(first, index) || !hasNeighbor(second, index) || !hasNeighbor(first, second) || !hasNeighbor(second, first)) { return hidden(); }
	// 接続順が入れ替わっても、同じ3点の面は同じ確率で採用する。
	let identity = hash(index) ^ hash(min(first, second) + 131u) ^ hash(max(first, second) + 977u);
	if (random(identity, 701u) >= uniforms.faceProbability) { return hidden(); }
	let a = points[index];
	let b = points[first];
	let c = points[second];
	let normal = cross(b.position.xyz - a.position.xyz, c.position.xyz - a.position.xyz);
	let areaSquared = dot(normal, normal);
	if (areaSquared < 1e-20) { return hidden(); }
	let light = 1.0 - uniforms.shading * (1.0 - abs(dot(rotate(normal * inverseSqrt(areaSquared)), uniforms.cameraForward))) * 0.7;
	let opacity = min(edgeOpacity(a, b), min(edgeOpacity(a, c), edgeOpacity(b, c)));
	let position = cameraPosition(select(select(a.position.xyz, b.position.xyz, vertex == 1u), c.position.xyz, vertex == 2u));
	// 三角形は同次座標のまま渡し、Near面を跨ぐ部分はGPUのクリッピングに任せる。
	return VertexOutput(project(position), vec2f(0.0), vec4f(uniforms.faceColor.rgb * light, uniforms.faceColor.a * opacity), position.z);
}

fn premultipliedColor(fragment: VertexOutput, coverage: f32) -> vec4f {
	var opacity = clamp(fragment.color.a, 0.0, 1.0) * coverage;
	if (uniforms.nearFade > 0.0) {
		opacity *= smoothstep(uniforms.nearClip, uniforms.nearClip + uniforms.nearFade, fragment.cameraDepth);
	}
	return vec4f(fragment.color.rgb * opacity, opacity);
}

@fragment
fn pointFragment(fragment: VertexOutput) -> @location(0) vec4f {
	let radius = length(fragment.local);
	let coverage = 1.0 - smoothstep(max(0.0, 1.0 - max(fwidth(radius), 0.00001)), 1.0, radius);
	let color = premultipliedColor(fragment, coverage);
	if (color.a <= 0.0) { discard; }
	return color;
}

@fragment
fn surfaceFragment(fragment: VertexOutput) -> @location(0) vec4f {
	let color = premultipliedColor(fragment, 1.0);
	if (color.a <= 0.0) { discard; }
	return color;
}
