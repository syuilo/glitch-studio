// GPUTextureViewは寸法を公開しない。エフェクトへ渡すdeviceだけを包み、
// 元のGPUオブジェクトの同一性を保ったまま、mipごとの描画寸法を記録する。
const viewSizes = new WeakMap<GPUTextureView, { width: number; height: number }>();
const trackedTextures = new WeakSet<GPUTexture>();

export function trackEffectRenderTexture(texture: GPUTexture): GPUTexture {
	if (trackedTextures.has(texture)) return texture;
	trackedTextures.add(texture);
	const createView = texture.createView.bind(texture);
	texture.createView = descriptor => {
		const view = createView(descriptor);
		const scale = 2 ** (descriptor?.baseMipLevel ?? 0);
		viewSizes.set(view, { width: Math.max(1, Math.floor(texture.width / scale)), height: Math.max(1, Math.floor(texture.height / scale)) });
		return view;
	};
	return texture;
}

export function getEffectRenderViewSize(view: GPUTextureView) {
	const size = viewSizes.get(view);
	if (size == null) throw new Error('Effect render target view was created outside the tracked effect device.');
	return size;
}

export function createEffectRenderDevice(device: GPUDevice): GPUDevice {
	return new Proxy(device, {
		get(target, property) {
			if (property === 'createTexture') return (descriptor: GPUTextureDescriptor) => trackEffectRenderTexture(target.createTexture(descriptor));
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
