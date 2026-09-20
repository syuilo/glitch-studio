import type { NodeOutputReference, NodeParamValue } from '../../shared/src/types.ts';

const connected: NodeParamValue = { inputSource: 'node', nodeId: 'source', outputPort: 'mask' };
const disconnected: NodeParamValue = { inputSource: 'node', nodeId: null, outputPort: null };
const literal: NodeOutputReference = { nodeId: 'source', outputPort: 'mask' };
// @ts-expect-error 接続済みなら出力ポートが必須。
const missing: NodeParamValue = { inputSource: 'node', nodeId: 'source' };
// @ts-expect-error 接続済みで出力ポートをnullにはできない。
const nullPort: NodeParamValue = { inputSource: 'node', nodeId: 'source', outputPort: null };
// @ts-expect-error 未接続なのに出力ポートだけ残すことはできない。
const danglingPort: NodeParamValue = { inputSource: 'node', nodeId: null, outputPort: 'mask' };
// @ts-expect-error literalの接続情報でも出力ポートが必須。
const missingLiteralPort: NodeOutputReference = { nodeId: 'source' };
