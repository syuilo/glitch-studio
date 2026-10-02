function estimateTextureBytes(texture: GPUTexture): number {
	const { format } = texture;
	let blockWidth = 1;
	let blockHeight = 1;
	let bytesPerBlock: number;
	const color = /^(r|rg|rgba|bgra)(8|16|32)/.exec(format);
	const astc = /^astc-(\d+)x(\d+)-/.exec(format);
	if (color) {
		bytesPerBlock = color[1].length * Number(color[2]) / 8;
	} else if (astc) {
		blockWidth = Number(astc[1]);
		blockHeight = Number(astc[2]);
		bytesPerBlock = 16;
	} else if (/^(bc|etc2|eac)-?/.test(format)) {
		blockWidth = blockHeight = 4;
		bytesPerBlock = /^(bc[14]-|etc2-rgb8|eac-r11)/.test(format) ? 8 : 16;
	} else {
		// Depth/stencil allocation is implementation-dependent; use a nominal size.
		const packed: Partial<Record<GPUTextureFormat, number>> = {
			rgb10a2uint: 4, rgb10a2unorm: 4, rg11b10ufloat: 4, rgb9e5ufloat: 4,
			stencil8: 1, depth16unorm: 2, depth24plus: 4, 'depth24plus-stencil8': 4,
			depth32float: 4, 'depth32float-stencil8': 8,
		};
		bytesPerBlock = packed[format] ?? 0;
	}
	let bytes = 0;
	for (let level = 0; level < texture.mipLevelCount; level++) {
		const width = Math.max(1, Math.floor(texture.width / 2 ** level));
		const height = Math.max(1, Math.floor(texture.height / 2 ** level));
		const depth = texture.dimension === '3d' ? Math.max(1, Math.floor(texture.depthOrArrayLayers / 2 ** level)) : texture.depthOrArrayLayers;
		bytes += Math.ceil(width / blockWidth) * Math.ceil(height / blockHeight) * depth * bytesPerBlock * texture.sampleCount;
	}
	return bytes;
}

type Allocation = { kind: 'textures' | 'buffers'; bytes: number; };

// Tracks logical resource sizes, not driver allocation or physical VRAM residency.
// Install before creating resources. Keep the real WebGPU objects and their identity.
export class GpuMemoryTracker {
	#usage = { textures: 0, buffers: 0 };
	#active = true;
	#finalizer = new FinalizationRegistry<Allocation>(({ kind, bytes }) => {
		if (this.#active) this.#usage[kind] -= bytes;
	});

	constructor(device: GPUDevice) {
		const createTexture = device.createTexture.bind(device);
		device.createTexture = descriptor => {
			const texture = createTexture(descriptor);
			return this.#track(texture, 'textures', estimateTextureBytes(texture));
		};
		const createBuffer = device.createBuffer.bind(device);
		device.createBuffer = descriptor => {
			const buffer = createBuffer(descriptor);
			return this.#track(buffer, 'buffers', buffer.size);
		};
		const destroy = device.destroy.bind(device);
		device.destroy = () => {
			destroy();
			this.#reset();
		};
		void device.lost.then(() => this.#reset());
	}

	#track<T extends GPUTexture | GPUBuffer>(resource: T, kind: Allocation['kind'], bytes: number): T {
		if (!this.#active) return resource;
		this.#usage[kind] += bytes;
		const allocation = { kind, bytes };
		// Do not keep strong references to resources just to measure them.
		this.#finalizer.register(resource, allocation, allocation);
		const destroy = resource.destroy.bind(resource);
		let destroyed = false;
		resource.destroy = () => {
			destroy();
			if (destroyed) return;
			destroyed = true;
			this.#finalizer.unregister(allocation);
			if (this.#active) this.#usage[kind] -= bytes;
		};
		return resource;
	}

	#reset() {
		this.#active = false;
		this.#usage = { textures: 0, buffers: 0 };
	}

	getUsage() {
		return { ...this.#usage, total: this.#usage.textures + this.#usage.buffers };
	}
}
