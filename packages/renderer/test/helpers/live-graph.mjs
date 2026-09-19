import assert from 'node:assert/strict';
import { after } from 'node:test';

export function visualModule(nodes, outputNodeId, definitions) {
	const node = nodes.find(node => node.id === outputNodeId);
	const outputs = node?.type === 'effect' ? definitions[node.effectId].outputs : {};
	const outputPort = Object.keys(outputs).find(port => outputs[port].primary);
	return {
		id: 'test-module', name: 'Test', paramDefs: [],
		outputDefs: [{ id: 'result', name: 'Result', dataType: 'color', isPrimaryOutput: true }],
		nodes: [...nodes, { id: 'test-out', type: 'globalOut', inputs: {
			result: outputPort == null ? { nodeId: null, outputPort: null } : { nodeId: outputNodeId, outputPort },
		} }],
	};
}

// 実際のライブ描画ループを、テストが指定した時刻で1フレームずつ進める。
const previousRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const previousCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
after(() => {
	for (const [name, descriptor] of [['requestAnimationFrame', previousRaf], ['cancelAnimationFrame', previousCancel]]) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete globalThis[name];
	}
});
let scheduled;
globalThis.requestAnimationFrame = fn => { scheduled = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};

export function createLiveGraph(renderer, initialNodes, definitions) {
	let callback;
	let nodes = initialNodes;
	let outputId;
	let started = false;
	function updateNodes(next) {
		nodes = next;
		renderer.updateVisualModules([visualModule(nodes, outputId, definitions)]);
	}
	return {
		updateNodes,
		frame(id, time) {
			if (id !== outputId || !started) {
				outputId = id;
				updateNodes(nodes);
			}
			if (!started) {
				renderer.startLiveRenderLoopFor('test-module');
				callback = scheduled;
				started = true;
			}
			assert.equal(typeof callback, 'function');
			callback(time);
		},
	};
}
