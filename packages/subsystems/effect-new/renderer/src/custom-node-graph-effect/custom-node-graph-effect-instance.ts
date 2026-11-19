import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectNode } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { EffectSource, ResolvedEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectFrame, EffectInstance, EffectInstanceOptions, EffectOutputPort } from '../effect-instance.ts';
import { largestResolution, planParameter } from './parameter-binding.ts';
import type { EvaluateCustomNodeGraphEffectBinding, ParameterReader, ParameterReaderContext, PlannedParameter } from './parameter-binding.ts';

export type { EvaluateCustomNodeGraphEffectBinding } from './parameter-binding.ts';

type ResolveEffectSource = (source: EffectSource) => ResolvedEffectSource;
type CreateLeafInstance = (source: Exclude<ResolvedEffectSource, { type: 'customNodeGraphEffect' }>, options: EffectInstanceOptions) => Promise<EffectInstance>;

// layoutだけを要求したポートでも、別の接続から実際に読まれるときはvalueへ昇格する。
type Demand = 'layout' | 'value';

function needsDemand(previous: Demand | undefined, demand: Demand): boolean {
	return previous == null || (previous === 'layout' && demand === 'value');
}

type GraphExecution = {
	instances: EffectInstance[];
	steps: ((frame: EffectFrame) => void)[];
};

function readerForPort(port: EffectOutputPort): ParameterReader {
	const { layout, source } = port;
	return {
		layout, output: port,
		textureResolution: layout.kind === 'texture' ? layout.resolution : null,
		read: source.type === 'produced' ? source.read : frame => frame.parameters[source.parameterId],
	};
}

/** 供給元が確定している配線はそのまま共有する。式などで値を作る引数だけに、その配置の評価ステップを作る。 */
function bindGraphArgument(reader: ParameterReader, execution: GraphExecution): ParameterReader {
	if (reader.output != null) return reader;
	let value: unknown;
	execution.steps.push(frame => { value = reader.read(frame); });
	const read = () => value;
	if (reader.layout.kind === 'value') return { ...reader, read };
	return readerForPort({ layout: reader.layout, source: { type: 'produced', read: () => value as UniformOrTexture } });
}

type NodePlan = {
	node: CustomNodeGraphEffectNode;
	source: ResolvedEffectSource;
	childGraph: CustomNodeGraphEffectPlan | null;
	requestedOutputs: Map<string, Demand>;
	parameters: Map<string, { demand: Demand; reader: PlannedParameter }>;
	dependencies: Set<NodePlan>;
};

// Aの一つ目の出力を発見した後、別の配線から二つ目の出力が必要になることがある。
// 必要なポートをすべて集めた後にだけ描画順を決め、両方のための上流をAより先に実行する。
class CustomNodeGraphEffectPlan {
	private readonly customNodeGraphEffect: CustomNodeGraphEffect;
	private readonly resolveSource: ResolveEffectSource;
	private readonly onPublicInputRequired: (id: string, demand: Demand) => void;
	private readonly nodes: Map<string, CustomNodeGraphEffectNode>;
	private readonly usedNodes = new Map<string, NodePlan>();
	private readonly publicInputs = new Map<string, Demand>();
	private readonly publicOutputs = new Map<string, { connection: CustomNodeGraphEffectConnection; demand: Demand }>();

	public constructor(customNodeGraphEffect: CustomNodeGraphEffect, resolveSource: ResolveEffectSource, onPublicInputRequired: (id: string, demand: Demand) => void) {
		this.customNodeGraphEffect = customNodeGraphEffect;
		this.resolveSource = resolveSource;
		this.onPublicInputRequired = onPublicInputRequired;
		this.nodes = new Map(customNodeGraphEffect.nodes.map(node => [node.id, node]));
	}

	public requireOutput(id: string, demand: Demand): void {
		const connection = this.customNodeGraphEffect.outputs[id];
		if (connection == null || !needsDemand(this.publicOutputs.get(id)?.demand, demand)) return;
		this.publicOutputs.set(id, { connection, demand });
		this.requireConnection(connection, demand);
	}

	private requirePublicInput(id: string, demand: Demand): void {
		if (!needsDemand(this.publicInputs.get(id), demand)) return;
		this.publicInputs.set(id, demand);
		this.onPublicInputRequired(id, demand);
	}

	private requireConnection(connection: CustomNodeGraphEffectConnection, demand: Demand): NodePlan | null {
		if (connection.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			this.requirePublicInput(connection.parameterId, demand);
			return null;
		}
		let plan = this.usedNodes.get(connection.nodeId);
		if (plan == null) {
			const node = this.nodes.get(connection.nodeId)!;
			const source = this.resolveSource(node.effectSource);
			const placement: NodePlan = { node, source, childGraph: null, requestedOutputs: new Map(), parameters: new Map(), dependencies: new Set() };
			this.usedNodes.set(node.id, placement);
			if (source.type === 'customNodeGraphEffect') {
				// 入れ子でも、要求出力へ届く公開入力だけを親に伝える。同一定義の別配置には別の計画を持たせる。
				placement.childGraph = new CustomNodeGraphEffectPlan(source.definition, this.resolveSource, (id, usage) => this.requireParameter(placement, id, usage));
				if (node.resolution == null) {
					for (const id of source.definition.resolutionInputParameters) this.requireParameter(placement, id, 'layout');
				}
			}
			plan = placement;
		}
		if (needsDemand(plan.requestedOutputs.get(connection.outputPort), demand)) {
			plan.requestedOutputs.set(connection.outputPort, demand);
			if (plan.childGraph != null) {
				plan.childGraph.requireOutput(connection.outputPort, demand);
			} else {
				for (const id of Object.keys(plan.source.definition.paramDefs)) this.requireParameter(plan, id, demand);
			}
		}
		return plan;
	}

	private requireParameter(plan: NodePlan, id: string, demand: Demand): void {
		if (!needsDemand(plan.parameters.get(id)?.demand, demand)) return;
		const definition = plan.source.definition.paramDefs[id];
		const parameter = planParameter(definition, plan.node.params[id] ?? definition.defaultValue, connection => {
			const dependency = this.requireConnection(connection, demand);
			if (dependency != null) plan.dependencies.add(dependency);
		}, () => {
			if (demand === 'layout') return;
			for (const [key, publicDefinition] of Object.entries(this.customNodeGraphEffect.paramDefs)) {
				if (publicDefinition.canNode !== true) this.requirePublicInput(key, 'value');
			}
		});
		plan.parameters.set(id, { demand, reader: parameter });
	}

	private renderOrder(): NodePlan[] {
		const visited = new Set<NodePlan>();
		const order: NodePlan[] = [];
		const visit = (plan: NodePlan) => {
			if (visited.has(plan)) return;
			visited.add(plan);
			for (const dependency of plan.dependencies) visit(dependency);
			order.push(plan);
		};
		for (const plan of this.usedNodes.values()) visit(plan);
		return order;
	}

	/** 入れ子の配置も同じ実行列へ展開する。公開入力・出力を通過するだけのグラフには描画ステップが要らない。 */
	public async compile(resolution: Readonly<Resolution>, publicInputs: ReadonlyMap<string, ParameterReader>,
		execution: GraphExecution, createLeafInstance: CreateLeafInstance,
		evaluateBinding?: EvaluateCustomNodeGraphEffectBinding): Promise<Map<string, ParameterReader>> {
		const outputsByNode = new Map<string, Map<string, ParameterReader>>();
		const resolveConnection = (connection: CustomNodeGraphEffectConnection): ParameterReader | null => {
			if (connection.inputSource === 'node') return outputsByNode.get(connection.nodeId)?.get(connection.outputPort) ?? null;
			const reader = publicInputs.get(connection.parameterId);
			if (reader == null) throw new Error(`Missing Custom Node Graph Effect input layout: ${connection.parameterId}`);
			return reader;
		};
		// 式の公開引数は配置のスコープに束縛する。画像の配線は式のために読み取らない。
		const expressionInputs = [...publicInputs].filter(([, reader]) => reader.layout.kind === 'value');
		for (const plan of this.renderOrder()) {
			let nodeResolution = resolution;
			const context: ParameterReaderContext = {
				resolveConnection,
				evaluate: (binding, definition, frame) => {
					if (evaluateBinding == null) throw new Error('Custom Node Graph Effect parameter evaluation is unavailable');
					const parameters = Object.fromEntries(expressionInputs.map(([id, reader]) => [id, reader.read(frame)]));
					return evaluateBinding(binding, definition, { customNodeGraphEffect: this.customNodeGraphEffect,
						node: plan.node, resolution: nodeResolution, frame: { ...frame, parameters } });
				},
			};
			const readers = new Map(Array.from(plan.parameters, ([id, parameter]) => [id, parameter.reader(context)]));
			nodeResolution = plan.node.resolution
				?? largestResolution(plan.source.definition.resolutionInputParameters.map(id => readers.get(id)?.textureResolution ?? null))
				?? resolution;
			if (plan.source.type === 'customNodeGraphEffect') {
				for (const [id, reader] of readers) {
					if (plan.parameters.get(id)!.demand !== 'value') continue;
					// 空間入力の配線は供給元へ直結する。配列・構造体の中の画像には、要素自身の接続で指定したsamplingが必要。
					readers.set(id, reader.output != null ? readerForPort(reader.output) : bindGraphArgument(reader, execution));
				}
				const outputs = await plan.childGraph!.compile(nodeResolution, readers, execution, createLeafInstance, evaluateBinding);
				outputsByNode.set(plan.node.id, outputs);
				continue;
			}
			const instance = await createLeafInstance(plan.source, {
				resolution: nodeResolution,
				requestedOutputIds: [...plan.requestedOutputs.keys()],
				staticSettings: plan.node.staticSettings,
				inputLayouts: Object.fromEntries(Array.from(readers, ([id, reader]) => [id, reader.layout])),
			});

			const ports = Object.entries(instance.outputs);
			const renders = ports.some(([id, port]) =>
				plan.requestedOutputs.get(id) === 'value' && port.source.type === 'produced');
			// 寸法または入力への直結だけを利用する配置は、確定済みのポート情報だけを残す。
			if (renders) execution.instances.push(instance);
			else instance.dispose();
			const outputs = new Map<string, ParameterReader>();
			for (const [id, port] of ports) {
				if (port.source.type === 'produced') {
					outputs.set(id, readerForPort(port));
					continue;
				}
				const parameterId = port.source.parameterId;
				let reader = readers.get(parameterId)!;
				if (plan.requestedOutputs.get(id) === 'value') {
					reader = bindGraphArgument(reader, execution);
					readers.set(parameterId, reader);
				}
				// Native Effectの入力にも読み取り側のsamplingが付く。直結出力はその前の供給元を公開する。
				outputs.set(id, reader.output == null ? reader : readerForPort(reader.output));
			}
			if (renders) {
				const frameReaders = [...readers].filter(([id]) => plan.parameters.get(id)!.demand === 'value');
				execution.steps.push(frame => {
					const parameters = Object.fromEntries(frameReaders.map(([id, reader]) => [id, reader.read(frame)]));
					instance.render({ ...frame, parameters });
				});
			}
			outputsByNode.set(plan.node.id, outputs);
		}

		const outputs = new Map<string, ParameterReader>();
		for (const [id, { connection }] of this.publicOutputs) {
			const reader = resolveConnection(connection);
			if (reader != null) outputs.set(id, reader);
		}
		return outputs;
	}
}

export async function createCustomNodeGraphEffectInstance(customNodeGraphEffect: CustomNodeGraphEffect, options: EffectInstanceOptions,
	resolveSource: ResolveEffectSource, createLeafInstance: CreateLeafInstance, evaluateBinding?: EvaluateCustomNodeGraphEffectBinding): Promise<EffectInstance> {
	const plan = new CustomNodeGraphEffectPlan(customNodeGraphEffect, resolveSource, () => {});
	for (const id of options.requestedOutputIds) plan.requireOutput(id, 'value');
	const publicInputs = new Map<string, ParameterReader>();
	for (const [id, layout] of Object.entries(options.inputLayouts)) {
		publicInputs.set(id, layout.kind === 'value'
			? { layout, textureResolution: null, read: frame => frame.parameters[id] }
			: readerForPort({ layout, source: { type: 'parameter', parameterId: id } }));
	}

	const execution: GraphExecution = { instances: [], steps: [] };
	const dispose = () => {
		for (let i = execution.instances.length - 1; i >= 0; i--) execution.instances[i].dispose();
		execution.instances.length = 0;
		execution.steps.length = 0;
	};
	try {
		const readers = await plan.compile(options.resolution, publicInputs, execution, createLeafInstance, evaluateBinding);
		const ports: [string, EffectOutputPort][] = [];
		for (const [id, reader] of readers) {
			if (reader.output != null) ports.push([id, reader.output]);
		}
		return {
			outputs: Object.fromEntries(ports),
			render(frame) {
				for (const step of execution.steps) step(frame);
			},
			dispose,
		};
	} catch (error) {
		// 子の初期化が失敗した場合も、それまでに生成した配置が所有するGPUリソースを解放する。
		dispose();
		throw error;
	}
}
