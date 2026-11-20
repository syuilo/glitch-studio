// エフェクトへ渡すdeviceだけを包み、元のGPUオブジェクトの同一性を保ったまま、
// Viewのmip寸法と、試し描きでstorageを書き換えないpipelineの情報を記録する。
const viewSizes = new WeakMap<GPUTextureView, { width: number; height: number }>();
const viewLayouts = new WeakMap<GPUTextureView, { format: GPUTextureFormat; sampleCount: number }>();
const trackedTextures = new WeakSet<GPUTexture>();
const readOnlyBindGroupLayouts = new WeakSet<GPUBindGroupLayout>();
const readOnlyPipelineLayouts = new WeakSet<GPUPipelineLayout>();
const probeSafePipelines = new WeakSet<GPURenderPipeline>();

/** 試し描きでstorageを二重に更新しない。追跡できない外部・auto layoutも対象外にする。 */
export function isEffectRenderPipelineProbeSafe(pipeline: GPURenderPipeline): boolean {
	return probeSafePipelines.has(pipeline);
}

export function trackEffectRenderTexture(texture: GPUTexture): GPUTexture {
	if (trackedTextures.has(texture)) return texture;
	trackedTextures.add(texture);
	const createView = texture.createView.bind(texture);
	texture.createView = descriptor => {
		const view = createView(descriptor);
		const scale = 2 ** (descriptor?.baseMipLevel ?? 0);
		viewSizes.set(view, { width: Math.max(1, Math.floor(texture.width / scale)), height: Math.max(1, Math.floor(texture.height / scale)) });
		viewLayouts.set(view, { format: descriptor?.format ?? texture.format, sampleCount: texture.sampleCount });
		return view;
	};
	return texture;
}

export function getEffectRenderViewSize(view: GPUTextureView) {
	const size = viewSizes.get(view);
	if (size == null) throw new Error('Effect render target view was created outside the tracked effect device.');
	return size;
}

/** Viewによるformatの上書きも含め、Render Bundleと実際のattachmentを対応させる。 */
export function getEffectRenderViewLayout(view: GPUTextureView) {
	return viewLayouts.get(view) ?? null;
}

export function createEffectRenderDevice(device: GPUDevice): GPUDevice {
	return new Proxy(device, {
		get(target, property) {
			if (property === 'createTexture') return (descriptor: GPUTextureDescriptor) => trackEffectRenderTexture(target.createTexture(descriptor));
			if (property === 'createBindGroupLayout') return (descriptor: GPUBindGroupLayoutDescriptor) => {
				const entries = Array.from(descriptor.entries);
				const layout = target.createBindGroupLayout({ ...descriptor, entries });
				if (entries.every(entry => entry.buffer?.type !== 'storage'
					&& (entry.storageTexture == null || entry.storageTexture.access === 'read-only'))) readOnlyBindGroupLayouts.add(layout);
				return layout;
			};
			if (property === 'createPipelineLayout') return (descriptor: GPUPipelineLayoutDescriptor) => {
				const bindGroupLayouts = Array.from(descriptor.bindGroupLayouts);
				const layout = target.createPipelineLayout({ ...descriptor, bindGroupLayouts });
				if (bindGroupLayouts.every(bindGroupLayout => bindGroupLayout == null || readOnlyBindGroupLayouts.has(bindGroupLayout))) readOnlyPipelineLayouts.add(layout);
				return layout;
			};
			if (property === 'createRenderPipeline') return (descriptor: GPURenderPipelineDescriptor) => {
				const pipeline = target.createRenderPipeline(descriptor);
				if (descriptor.layout !== 'auto' && readOnlyPipelineLayouts.has(descriptor.layout)) probeSafePipelines.add(pipeline);
				return pipeline;
			};
			if (property === 'createRenderPipelineAsync') return async (descriptor: GPURenderPipelineDescriptor) => {
				const pipeline = await target.createRenderPipelineAsync(descriptor);
				if (descriptor.layout !== 'auto' && readOnlyPipelineLayouts.has(descriptor.layout)) probeSafePipelines.add(pipeline);
				return pipeline;
			};
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
