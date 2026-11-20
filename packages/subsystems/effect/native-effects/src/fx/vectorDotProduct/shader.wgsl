@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	return dot(read_inputA(position), read_inputB(position));
}
