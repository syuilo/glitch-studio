export function gpuFixture() {
	const texture = ({ size = [1, 1], format = 'rgba8unorm' } = {}) => ({
		width: size.width ?? size[0], height: size.height ?? size[1], depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1,
		format, dimension: '2d', createView: () => ({}), destroy() {},
	});
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		features: new Set(), lost: new Promise(() => {}), destroy() {},
		createTexture: texture, createBuffer: ({ size }) => ({ size, destroy() {} }),
		createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), createSampler: () => ({}), createBindGroup: () => ({}),
		createBindGroupLayout: () => ({}), createPipelineLayout: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createRenderBundleEncoder: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, finish: () => ({}) }),
		async createRenderPipelineAsync(options) { return this.createRenderPipeline(options); },
		createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
		pushErrorScope() {}, async popErrorScope() { return null; },
		createCommandEncoder: () => ({ finish: () => ({}), beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, executeBundles() {}, end() {} }) }),
		queue: { submit() {}, async onSubmittedWorkDone() {}, writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {} },
	};
	return { device, texture };
}

/** 描画時の値を観測し、後続フレームによるgetterの変化から独立させる。 */
export function snapshotNativeInputs(inputs) {
	function read(input) {
		switch (input.kind) {
			case 'array': return input.elements.map(read);
			case 'struct': return Object.fromEntries(Object.entries(input.fields).map(([id, field]) => [id, read(field)]));
			case 'value': return input.value;
			case 'uniform': return { kind: 'uniform', value: [...input.value] };
			case 'texture': return { kind: 'texture', texture: input.texture, ...input.sampling };
		}
	}
	return Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, read(input)]));
}
