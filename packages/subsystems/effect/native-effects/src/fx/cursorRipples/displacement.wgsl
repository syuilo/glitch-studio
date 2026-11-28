override GRID_WIDTH: u32;
override GRID_HEIGHT: u32;
override GRADIENT_X: f32;
override GRADIENT_Y: f32;

struct OutputParams {
	intensity: f32,
};

@group(0) @binding(0) var<storage, read> heightField: array<f32>;
@group(0) @binding(1) var gradientTexture: texture_2d<f32>;
@group(0) @binding(2) var gradientSampler: sampler;
@group(0) @binding(3) var<uniform> outputParams: OutputParams;

fn heightAt(cell: vec2i) -> f32 {
	if (any(cell < vec2i(0)) || any(cell >= vec2i(i32(GRID_WIDTH), i32(GRID_HEIGHT)))) { return 0.0; }
	return heightField[u32(cell.y) * GRID_WIDTH + u32(cell.x)];
}

@fragment
fn gradient(@builtin(position) position: vec4f) -> @location(0) vec2f {
	let cell = vec2i(position.xy);
	// テクスチャの行は下方向に増えるため、Yは上側から下側を引いて公開座標の+Yに合わせる。
	return vec2f(
		heightAt(cell + vec2i(1, 0)) - heightAt(cell - vec2i(1, 0)),
		heightAt(cell - vec2i(0, 1)) - heightAt(cell + vec2i(0, 1)),
	) * vec2f(GRADIENT_X, GRADIENT_Y);
}

@fragment
fn displacement(@location(0) position: vec2f) -> @location(0) vec2f {
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	let slope = textureSampleLevel(gradientTexture, gradientSampler, uv, 0.0).rg;
	// 波が重なっても、極端に大きな移動で画像の大半を飛び越えないようにする。
	return clamp(slope * outputParams.intensity, vec2f(-0.15), vec2f(0.15));
}
