import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectNode } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { EffectSource, ResolvedEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectFrame, EffectInstance, EffectInstanceOptions, EffectOutputLayout } from '../effect-instance.ts';
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

	public async instantiate(options: EffectInstanceOptions, createLeafInstance: CreateLeafInstance,
		evaluateBinding?: EvaluateCustomNodeGraphEffectBinding): Promise<EffectInstance> {
		const outputsByNode = new Map<string, Map<string, ParameterReader>>();
		const resolveConnection = (connection: CustomNodeGraphEffectConnection): ParameterReader | null => {
			if (connection.inputSource === 'node') return outputsByNode.get(connection.nodeId)?.get(connection.outputPort) ?? null;
			const id = connection.parameterId;
			const layout = options.inputLayouts[id];
			// 参照された公開入力には呼び出し元が配置時に固定したlayoutを必ず渡す。
			return { layout, textureResolution: layout.kind === 'texture' ? layout.resolution : null, read: frame => frame.parameters[id] };
		};
		const steps: { render: (frame: EffectFrame) => void; instance: EffectInstance }[] = [];
		const dispose = () => {
			for (let i = steps.length - 1; i >= 0; i--) steps[i].instance.dispose();
			steps.length = 0;
		};
		try {
			for (const plan of this.renderOrder()) {
				let resolution: Readonly<Resolution> = options.resolution;
				const context: ParameterReaderContext = { resolveConnection, evaluate: (binding, definition, frame) => {
					if (evaluateBinding == null) throw new Error('Custom Node Graph Effect parameter evaluation is unavailable');
					return evaluateBinding(binding, definition, { customNodeGraphEffect: this.customNodeGraphEffect, node: plan.node, resolution, frame });
				} };
				const readers = Array.from(plan.parameters, ([key, parameter]) => [key, parameter.reader(context)] as const);
				const parameterReaders = new Map(readers);
				resolution = plan.node.resolution ?? largestResolution(plan.source.definition.resolutionInputParameters.map(id => parameterReaders.get(id)?.textureResolution ?? null)) ?? options.resolution;
				const childOptions = { resolution, requestedOutputIds: [...plan.requestedOutputs.keys()], staticSettings: plan.node.staticSettings,
					inputLayouts: Object.fromEntries(readers.map(([key, reader]) => [key, reader.layout])) };
				const instance = plan.source.type === 'customNodeGraphEffect'
					? await plan.childGraph!.instantiate(childOptions, createLeafInstance, evaluateBinding)
					: await createLeafInstance(plan.source, childOptions);
				let outputs: Readonly<Record<string, UniformOrTexture>>;
				outputsByNode.set(plan.node.id, new Map(Object.entries(instance.outputLayouts).map(([id, layout]) => [id, {
					layout, textureResolution: layout.kind === 'texture' ? layout.resolution : null, read: () => outputs[id],
				}])));
				if ([...plan.requestedOutputs.values()].includes('value')) {
					const frameReaders = readers.filter(([id]) => plan.parameters.get(id)!.demand === 'value');
					steps.push({ instance, render: frame => {
						const parameters = Object.fromEntries(frameReaders.map(([key, reader]) => [key, reader.read(frame)]));
						outputs = instance.render({ ...frame, parameters });
					} });
				} else {
					// Native Effectの出力表現も初期化で確定する。寸法だけの利用なら履歴を進めず、GPU資源も解放できる。
					instance.dispose();
				}
			}
			const outputLayouts: [string, EffectOutputLayout][] = [];
			const outputReaders: [string, ParameterReader][] = [];
			for (const [id, { connection, demand }] of this.publicOutputs) {
				const source = resolveConnection(connection);
				if (source == null || source.layout.kind === 'value') continue;
				outputLayouts.push([id, source.layout]);
				if (demand === 'value') outputReaders.push([id, source]);
			}
			return {
				outputLayouts: Object.fromEntries(outputLayouts),
				render: frame => {
					for (const step of steps) step.render(frame);
					return Object.fromEntries(outputReaders.map(([key, reader]) => [key, reader.read(frame) as UniformOrTexture]));
				},
				dispose,
			};
		} catch (error) {
			// 後続ノードのシェーダーコンパイル等が失敗しても、先に生成した配置のGPUリソースを解放する。
			dispose();
			throw error;
		}
	}
}

export async function createCustomNodeGraphEffectInstance(customNodeGraphEffect: CustomNodeGraphEffect, options: EffectInstanceOptions,
	resolveSource: ResolveEffectSource, createLeafInstance: CreateLeafInstance, evaluateBinding?: EvaluateCustomNodeGraphEffectBinding): Promise<EffectInstance> {
	const plan = new CustomNodeGraphEffectPlan(customNodeGraphEffect, resolveSource, () => {});
	for (const id of options.requestedOutputIds) plan.requireOutput(id, 'value');
	return plan.instantiate(options, createLeafInstance, evaluateBinding);
}
