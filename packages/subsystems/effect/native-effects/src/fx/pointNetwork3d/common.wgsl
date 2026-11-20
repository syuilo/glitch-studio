struct Uniforms {
	halfExtent: vec2f,
	pointCount: u32,
	maximumConnections: u32,
	extent: vec3f,
	distribution: u32,
	scale: vec3f,
	seed: u32,
	translation: vec3f,
	time: f32,
	rotation: vec3f,
	motionAmount: f32,
	motionFrequency: f32,
	motionSpeed: f32,
	connectionDistance: f32,
	connectionFade: f32,
	fixedConnections: u32,
	faceProbability: f32,
	pointSize: f32,
	lineWidth: f32,
	pointColor: vec4f,
	lineColor: vec4f,
	faceColor: vec4f,
	cameraPosition: vec3f,
	projectionScale: f32,
	cameraRight: vec3f,
	perspective: u32,
	cameraUp: vec3f,
	worldSize: u32,
	cameraForward: vec3f,
	nearClip: f32,
	nearFade: f32,
	shading: f32,
};

struct PointState {
	// 固定接続用と動的接続用の位置を分け、過去のフレームを参照せず再構築する。
	base: vec4f,
	position: vec4f,
};

struct Neighbors {
	indices: array<u32, NEIGHBOR_CAPACITY>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn hash(value: u32) -> u32 {
	var result = value;
	result = (result ^ (result >> 16u)) * 0x7feb352du;
	result = (result ^ (result >> 15u)) * 0x846ca68bu;
	return result ^ (result >> 16u);
}

fn random(index: u32, salt: u32) -> f32 {
	// 上位24bitを使い、f32への丸めで1.0が出ることを避ける。
	return f32(hash(index ^ hash(uniforms.seed + salt)) >> 8u) / 16777216.0;
}

fn rotate(position: vec3f) -> vec3f {
	let angle = uniforms.rotation * 6.28318530718;
	let c = cos(angle);
	let s = sin(angle);
	let x = vec3f(position.x, c.x * position.y - s.x * position.z, s.x * position.y + c.x * position.z);
	let y = vec3f(c.y * x.x + s.y * x.z, x.y, -s.y * x.x + c.y * x.z);
	return vec3f(c.z * y.x - s.z * y.y, s.z * y.x + c.z * y.y, y.z);
}

fn connectionPosition(point: PointState) -> vec3f {
	return select(point.position.xyz, point.base.xyz, uniforms.fixedConnections != 0u);
}

fn edgeOpacity(a: PointState, b: PointState) -> f32 {
	let distance = length(connectionPosition(a) - connectionPosition(b));
	if (uniforms.connectionFade <= 0.0) { return 1.0; }
	return 1.0 - smoothstep(uniforms.connectionDistance * (1.0 - uniforms.connectionFade), uniforms.connectionDistance, distance);
}
