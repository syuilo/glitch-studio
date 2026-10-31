@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	return evaluateColorRamp(read_input(position));
}
