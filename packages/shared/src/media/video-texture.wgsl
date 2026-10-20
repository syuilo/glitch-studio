struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
	let positions = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	let position = positions[index];
	var output: VertexOut;
	output.position = vec4f(position, 0.0, 1.0);
	output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
	return output;
}

@group(0) @binding(0) var sourceVideo: texture_external;
@group(0) @binding(1) var<uniform> quarterTurns: vec4u;

fn sourceCoordinates(uv: vec2f) -> vec2f {
	// Mediabunnyの回転情報はtoVideoFrame()に反映されないため、表示座標から
	// 回転前の動画座標へ戻す。VideoFrameの表示寸法・visibleRect・色変換はWebGPUに任せる。
	var sourceUv = uv;
	switch quarterTurns.x {
		case 1u: { sourceUv = vec2f(uv.y, 1.0 - uv.x); }
		case 2u: { sourceUv = vec2f(1.0) - uv; }
		case 3u: { sourceUv = vec2f(1.0 - uv.y, uv.x); }
		default: {}
	}
	return sourceUv;
}

@group(0) @binding(2) var convertedVideo: texture_2d<f32>;
@group(0) @binding(3) var videoSampler: sampler;

@fragment
fn renderExternalVideo(input: VertexOut) -> @location(0) vec4f {
	// alphaなしの形式だけがこの経路を使うため、そのまま補間できる。
	return textureSampleBaseClampToEdge(sourceVideo, videoSampler, sourceCoordinates(input.uv));
}

@fragment
fn renderCopiedVideo(input: VertexOut) -> @location(0) vec4f {
	// コピー時にpremultiply済み。二重乗算せず、透明な輪郭もこの表現のまま補間する。
	return textureSampleLevel(convertedVideo, videoSampler, sourceCoordinates(input.uv), 0.0);
}
