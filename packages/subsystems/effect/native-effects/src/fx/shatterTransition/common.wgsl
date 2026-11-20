struct Uniforms {
	halfExtent: vec2f,
	center: vec2f,
	grid: vec2u,
	irregularity: f32,
	spread: f32,
	depth: f32,
	rotation: f32,
	gravity: f32,
	stagger: f32,
	perspective: f32,
	shading: f32,
	seed: u32,
	endpoint: u32,
	texturedA: u32,
};

struct FragmentState {
	positions: array<vec4f, 3>,
	sources: array<vec2f, 3>,
	coverage: f32,
	light: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn hash(value: u32) -> u32 {
	var result = value;
	result = (result ^ (result >> 16u)) * 0x7feb352du;
	result = (result ^ (result >> 15u)) * 0x846ca68bu;
	return result ^ (result >> 16u);
}

fn random(index: u32, salt: u32) -> f32 {
	return f32(hash(index ^ hash(uniforms.seed + salt))) / 4294967296.0;
}

fn latticeVertex(cell: vec2u) -> vec2f {
	var position = vec2f(cell) / vec2f(uniforms.grid);
	// 境界は固定し、内部の共有頂点だけを動かす。変位をセル幅の22%以内に制限し、
	// 格子の折り返しや三角形の反転を防ぐ。隣接する破片は必ず同じ頂点を使う。
	if (all(cell > vec2u(0u)) && all(cell < uniforms.grid)) {
		let index = cell.y * (uniforms.grid.x + 1u) + cell.x;
		position += (vec2f(random(index, 11u), random(index, 29u)) * 2.0 - 1.0) * (0.22 * uniforms.irregularity) / vec2f(uniforms.grid);
	}
	return (position * 2.0 - 1.0) * uniforms.halfExtent;
}

fn rotate(position: vec3f, axis: vec3f, angle: f32) -> vec3f {
	let cosine = cos(angle);
	return position * cosine + cross(axis, position) * sin(angle) + axis * dot(axis, position) * (1.0 - cosine);
}
