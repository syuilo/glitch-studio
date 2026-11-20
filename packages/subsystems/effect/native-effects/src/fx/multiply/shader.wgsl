struct Uniforms { v: f32, };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	return read_input(position) * uniforms.v;
}
