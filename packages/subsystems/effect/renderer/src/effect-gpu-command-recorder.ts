import { getEffectRenderViewSize } from './effect-render-texture-views.ts';
import type TimingHelper from '@gs/shared/gpu/TimingHelper.ts';

type Rectangle = { x: number; y: number; width: number; height: number };
type PassCommand = { method: string; args: unknown[] };
type RecordedOperation =
	| { kind: 'render'; descriptor: GPURenderPassDescriptor; commands: PassCommand[] }
	| { kind: 'compute'; descriptor: GPUComputePassDescriptor; commands: PassCommand[] }
	| { kind: 'command'; command: PassCommand };

const deviceCompletions = new WeakMap<GPUDevice, { error: Error | null; listeners: Set<(error: Error) => void> }>();

function waitForEffectGpuWork(device: GPUDevice): Promise<void> {
	let state = deviceCompletions.get(device);
	if (state == null) {
		state = { error: null, listeners: new Set() };
		deviceCompletions.set(device, state);
		const tracked = state;
		// device.lostへタイルごとにthenを追加すると、デバイスの寿命中ずっと保持される。
		// 購読はデバイスに一度だけ行い、各待機のリスナーは完了時に外す。
		void device.lost?.then(info => {
			tracked.error = new Error(info.message || 'Effect GPU device was lost.');
			for (const listener of tracked.listeners) listener(tracked.error);
			tracked.listeners.clear();
		});
	}
	const tracked = state;
	if (tracked.error != null) return Promise.reject(tracked.error);
	return new Promise((resolve, reject) => {
		const lost = (error: Error) => reject(error);
		tracked.listeners.add(lost);
		void device.queue.onSubmittedWorkDone().then(() => {
			tracked.listeners.delete(lost);
			if (tracked.error != null) reject(tracked.error);
			else resolve();
		}, error => { tracked.listeners.delete(lost); reject(error); });
	});
}

function intersect(left: Rectangle, right: Rectangle): Rectangle {
	const x = Math.max(left.x, right.x);
	const y = Math.max(left.y, right.y);
	return { x, y, width: Math.max(0, Math.min(left.x + left.width, right.x + right.width) - x), height: Math.max(0, Math.min(left.y + left.height, right.y + right.height) - y) };
}

export function* effectRenderTiles(width: number, height: number, level: number): Generator<Rectangle> {
	if (!Number.isInteger(level) || level < 0 || level > 4) throw new Error('Effect render tile division level must be an integer from 0 to 4.');
	const columns = Math.min(width, 2 ** level);
	const rows = Math.min(height, 2 ** level);
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const x = Math.floor(width * column / columns);
			const y = Math.floor(height * row / rows);
			yield { x, y, width: Math.floor(width * (column + 1) / columns) - x, height: Math.floor(height * (row + 1) / rows) - y };
		}
	}
}

function snapshotArguments(method: string, args: unknown[]): unknown[] {
	return args.map((value, index) => {
		// dynamic offsetsなどの呼び出し後の書き換えを、再生時に参照しない。
		if (Array.isArray(value)) return [...value];
		if (value instanceof Uint32Array) return value.slice();
		if (method === 'setBindGroup' && index === 2 && value != null) return Array.from(value as Iterable<number>);
		const copyDescriptor = index < 2 && ['copyBufferToTexture', 'copyTextureToBuffer', 'copyTextureToTexture'].includes(method);
		if (value != null && typeof value === 'object' && (method === 'setBlendConstant' || copyDescriptor)) {
			const origin = Reflect.get(value, 'origin');
			return { ...value, ...(origin == null ? {} : { origin: Array.isArray(origin) ? [...origin] : { ...origin } }) };
		}
		return value;
	});
}

function callCommand(target: object, command: PassCommand) {
	Reflect.apply(Reflect.get(target, command.method), target, command.args);
}

function recordPass<T extends GPURenderPassEncoder | GPUComputePassEncoder>(commands: PassCommand[], finish: () => void): T {
	let ended = false;
	return new Proxy({ label: '' }, {
		get(target, property) {
			if (property === 'label') return target.label;
			return (...args: unknown[]) => {
				if (ended) throw new Error('Effect pass has already ended.');
				if (property === 'end') {
					ended = true;
					finish();
				} else {
					const method = String(property);
					commands.push({ method, args: snapshotArguments(method, args) });
				}
			};
		},
	}) as T;
}

/**
 * エフェクト1回分のコマンドだけを保持する。queueへのCPUアップロードは従来どおり
 * render中に行い、全コマンドの送信より前に完了する。同じインスタンスの次回描画は
 * execute完了まで開始しないため、記録中のuniformや内部テクスチャを上書きしない。
 */
export class EffectGpuCommandRecorder {
	private operations: RecordedOperation[] = [];
	private openPass = false;
	readonly encoder: GPUCommandEncoder;

	constructor() {
		this.encoder = new Proxy({ label: '' }, {
			get: (target, property) => {
				if (property === 'label') return target.label;
				if (property === 'beginRenderPass') return this.beginRenderPass;
				if (property === 'beginComputePass') return this.beginComputePass;
				return (...args: unknown[]) => {
					if (this.openPass || property === 'finish') throw new Error('Effect command encoder is owned by the tiled executor.');
					const method = String(property);
					this.operations.push({ kind: 'command', command: { method, args: snapshotArguments(method, args) } });
				};
			},
		}) as GPUCommandEncoder;
	}

	beginRenderPass = (descriptor: GPURenderPassDescriptor): GPURenderPassEncoder => {
		this.startPass();
		const commands: PassCommand[] = [];
		// WebIDLの省略可能なプロパティはnullではなくundefinedで未指定を表す。
		const snapshot = { ...descriptor, colorAttachments: Array.from(descriptor.colorAttachments, attachment => attachment == null ? null : { ...attachment,
			clearValue: attachment.clearValue == null ? undefined : Array.isArray(attachment.clearValue) ? [...attachment.clearValue] : { ...attachment.clearValue } }),
			depthStencilAttachment: descriptor.depthStencilAttachment == null ? undefined : { ...descriptor.depthStencilAttachment } };
		return recordPass(commands, () => { this.openPass = false; this.operations.push({ kind: 'render', descriptor: snapshot, commands }); });
	};

	beginComputePass = (descriptor: GPUComputePassDescriptor = {}): GPUComputePassEncoder => {
		this.startPass();
		const commands: PassCommand[] = [];
		return recordPass(commands, () => { this.openPass = false; this.operations.push({ kind: 'compute', descriptor: { ...descriptor }, commands }); });
	};

	private startPass() {
		if (this.openPass) throw new Error('Effect command encoder already has an open pass.');
		this.openPass = true;
	}

	async execute(device: GPUDevice, level: number, signal: AbortSignal, timingHelper: TimingHelper | null): Promise<number> {
		if (this.openPass) throw new Error('Effect render returned with an open pass.');
		let gpuTime = 0;
		const submit = async (encode: (encoder: GPUCommandEncoder) => void) => {
			signal.throwIfAborted();
			const encoder = device.createCommandEncoder();
			encode(encoder);
			device.queue.submit([encoder.finish()]);
			// 投入境界だけではバックエンドが複数タイルをまとめる可能性があるため、
			// 完了を確認してから次を送信する。待機中に中断しても送信済みの仕事は取り消せない。
			const result = timingHelper?.getResult() ?? Promise.resolve(0);
			const [, duration] = await Promise.all([waitForEffectGpuWork(device), result]);
			gpuTime += duration;
			signal.throwIfAborted();
		};
		for (const operation of this.operations) {
			if (operation.kind === 'command') {
				await submit(encoder => callCommand(encoder, operation.command));
			} else if (operation.kind === 'compute') {
				await submit(encoder => {
					const pass = timingHelper?.beginComputePass(encoder, operation.descriptor) ?? encoder.beginComputePass(operation.descriptor);
					for (const command of operation.commands) callCommand(pass, command);
					pass.end();
				});
			} else {
				const attachments = Array.from(operation.descriptor.colorAttachments);
				const view = attachments.find(attachment => attachment != null)?.view ?? operation.descriptor.depthStencilAttachment?.view;
				if (view == null) throw new Error('Tiled effect render pass needs a render target.');
				const size = getEffectRenderViewSize(view);
				// クエリの値をタイルごとに上書きしない。通常の画像パス以外は分割せず実行する。
				const tiled = operation.descriptor.occlusionQuerySet == null;
				const tiles = Array.from(effectRenderTiles(size.width, size.height, tiled ? level : 0));
				for (const [index, tile] of tiles.entries()) {
					await submit(encoder => {
						const last = index === tiles.length - 1;
						const depth = operation.descriptor.depthStencilAttachment;
						const descriptor: GPURenderPassDescriptor = { ...operation.descriptor,
							colorAttachments: attachments.map(attachment => attachment == null ? null : { ...attachment,
								loadOp: index === 0 ? attachment.loadOp : 'load', storeOp: last ? attachment.storeOp : 'store',
								resolveTarget: last ? attachment.resolveTarget : undefined } ),
							depthStencilAttachment: depth == null ? undefined : { ...depth,
								...(depth.depthLoadOp == null ? {} : { depthLoadOp: index === 0 ? depth.depthLoadOp : 'load', depthStoreOp: last ? depth.depthStoreOp : 'store' }),
								...(depth.stencilLoadOp == null ? {} : { stencilLoadOp: index === 0 ? depth.stencilLoadOp : 'load', stencilStoreOp: last ? depth.stencilStoreOp : 'store' }) },
						};
						const pass = timingHelper?.beginRenderPass(encoder, descriptor) ?? encoder.beginRenderPass(descriptor);
						pass.setScissorRect(tile.x, tile.y, tile.width, tile.height);
						for (const command of operation.commands) {
							if (command.method === 'setScissorRect') {
								const [x, y, width, height] = command.args as number[];
								const clipped = intersect(tile, { x, y, width, height });
								pass.setScissorRect(clipped.x, clipped.y, clipped.width, clipped.height);
							} else callCommand(pass, command);
						}
						pass.end();
					});
				}
			}
		}
		return gpuTime;
	}
}
