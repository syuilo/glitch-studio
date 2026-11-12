import { getEffectRenderViewLayout } from './effect-render-device.ts';
import type { EffectRenderTile } from './effect-render-tile-controller.ts';

export type EffectGpuPassCommand = { method: string; args: unknown[] };

export function callEffectGpuCommand(target: object, command: EffectGpuPassCommand) {
	Reflect.apply(Reflect.get(target, command.method), target, command.args);
}

const bundleCommands = new Set(['setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer',
	'draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'pushDebugGroup', 'popDebugGroup', 'insertDebugMarker']);
const passStateCommands = new Set(['setScissorRect', 'setViewport', 'setBlendConstant', 'setStencilReference']);

function replayPassState(pass: GPURenderPassEncoder, command: EffectGpuPassCommand, tile: EffectRenderTile) {
	if (command.method !== 'setScissorRect') {
		callEffectGpuCommand(pass, command);
		return;
	}
	const [x, y, width, height] = command.args as number[];
	const left = Math.max(tile.x, x);
	const top = Math.max(tile.y, y);
	pass.setScissorRect(left, top, Math.max(0, Math.min(tile.x + tile.width, x + width) - left),
		Math.max(0, Math.min(tile.y + tile.height, y + height) - top));
}

/**
 * 一回のエフェクト描画内で、同じパスの試し描き・タイル間だけコマンドとdescriptorを共有する。
 * 次のフレームへBundleを持ち越さないため、bind groupや外部動画の寿命・変更を推測しない。
 */
export class EffectRenderPassReplay {
	private replayCount = 0;
	private bundle: GPURenderBundle | null = null;
	private prefixStates: EffectGpuPassCommand[] = [];
	private descriptors = new Map<number, GPURenderPassDescriptor>();
	private device: GPUDevice;
	private original: GPURenderPassDescriptor;
	private commands: EffectGpuPassCommand[];

	constructor(device: GPUDevice, original: GPURenderPassDescriptor, commands: EffectGpuPassCommand[]) {
		this.device = device;
		this.original = original;
		this.commands = commands;
	}

	private createBundle(): GPURenderBundle | null {
		// Drawの途中でScissorなどが変わるパスは、その位置に状態変更が必要になる。
		// executeBundlesはbinding状態を継承しないため、部分Bundleへ無理に分割せず元の再生を使う。
		let hasDraw = false;
		for (const command of this.commands) {
			if (passStateCommands.has(command.method)) {
				if (hasDraw) return null;
			} else if (!bundleCommands.has(command.method)) return null;
			if (command.method.startsWith('draw')) hasDraw = true;
		}
		if (!hasDraw) return null;
		const attachments = Array.from(this.original.colorAttachments);
		const depth = this.original.depthStencilAttachment;
		const layouts = [...attachments.flatMap(attachment => attachment == null ? [] : [getEffectRenderViewLayout(attachment.view)]),
			...(depth == null ? [] : [getEffectRenderViewLayout(depth.view)])];
		const sampleCount = layouts[0]?.sampleCount;
		if (sampleCount == null || layouts.some(layout => layout == null || layout.format == null || layout.sampleCount !== sampleCount)) return null;
		const encoder = this.device.createRenderBundleEncoder({
			colorFormats: attachments.map(attachment => attachment == null ? null : getEffectRenderViewLayout(attachment.view)!.format),
			depthStencilFormat: depth == null ? undefined : getEffectRenderViewLayout(depth.view)!.format,
			sampleCount, depthReadOnly: depth?.depthReadOnly ?? false, stencilReadOnly: depth?.stencilReadOnly ?? false,
		});
		for (const command of this.commands) {
			if (passStateCommands.has(command.method)) this.prefixStates.push(command);
			else callEffectGpuCommand(encoder, command);
		}
		return encoder.finish();
	}

	replay(pass: GPURenderPassEncoder, tile: EffectRenderTile) {
		// 一枚だけで完了する軽いパスではBundleを生成する費用を払わない。
		if (++this.replayCount === 2) this.bundle = this.createBundle();
		pass.setScissorRect(tile.x, tile.y, tile.width, tile.height);
		if (this.bundle != null) {
			for (const command of this.prefixStates) replayPassState(pass, command, tile);
			pass.executeBundles([this.bundle]);
		} else {
			for (const command of this.commands) replayPassState(pass, command, tile);
		}
		pass.end();
	}

	descriptor(first: boolean, last: boolean, probe = false): GPURenderPassDescriptor {
		const key = probe ? 4 : Number(first) * 2 + Number(last);
		let descriptor = this.descriptors.get(key);
		if (descriptor != null) return descriptor;
		const depth = this.original.depthStencilAttachment;
		descriptor = { ...this.original,
			colorAttachments: Array.from(this.original.colorAttachments, attachment => attachment == null ? null : { ...attachment,
				loadOp: first || probe ? attachment.loadOp : 'load', storeOp: last && !probe ? attachment.storeOp : 'store',
				resolveTarget: last && !probe ? attachment.resolveTarget : undefined }),
			depthStencilAttachment: depth == null ? undefined : { ...depth,
				...(depth.depthLoadOp == null ? {} : { depthLoadOp: first ? depth.depthLoadOp : 'load', depthStoreOp: last ? depth.depthStoreOp : 'store' }),
				...(depth.stencilLoadOp == null ? {} : { stencilLoadOp: first ? depth.stencilLoadOp : 'load', stencilStoreOp: last ? depth.stencilStoreOp : 'store' }) },
		};
		this.descriptors.set(key, descriptor);
		return descriptor;
	}
}
