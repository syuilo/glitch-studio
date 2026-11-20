struct DecomposeVectorOutputs {
	@location(0) x: f32,
	@location(1) y: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> DecomposeVectorOutputs {
	let vector = read_input(position);
	return DecomposeVectorOutputs(vector.x, vector.y);
}
