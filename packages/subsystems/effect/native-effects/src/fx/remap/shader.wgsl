@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let value = read_input(position);
	let inMin = read_inMin(position);
	let inMax = read_inMax(position);
	let outMin = read_outMin(position);
	let outMax = read_outMax(position);
	return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
