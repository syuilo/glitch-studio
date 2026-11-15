export type ShaderBufferViewLayout =
	| { kind: 'typedArray'; type: 'Float32Array' | 'Int32Array' | 'Uint32Array' | 'Uint16Array' | 'Float16Array'; offset: number; length: number }
	| { kind: 'struct'; fields: Record<string, ShaderBufferViewLayout> }
	| { kind: 'array'; elements: ShaderBufferViewLayout[] };

export type ShaderBufferLayout = { byteLength: number; view: ShaderBufferViewLayout };
export type ShaderBufferLayouts = {
	uniforms: Record<string, ShaderBufferLayout>;
	storages: Record<string, ShaderBufferLayout>;
	structs: Record<string, ShaderBufferLayout>;
};

const arrayTypes = { Float32Array, Int32Array, Uint32Array, Uint16Array, Float16Array };

/** WGSLの型やアラインメントは解釈せず、ビルド済みの配置にだけ従って書き込む。 */
export function createShaderBuffer(layout: ShaderBufferLayout) {
	const arrayBuffer = new ArrayBuffer(layout.byteLength);

	function createWriter(viewLayout: ShaderBufferViewLayout): (value: unknown) => void {
		if (viewLayout.kind === 'typedArray') {
			const view = new arrayTypes[viewLayout.type](arrayBuffer, viewLayout.offset, viewLayout.length);
			return value => {
				if (value == null) return;
				if (typeof value === 'number') {
					view[0] = value;
				} else {
					const values = value as ArrayLike<number> | ArrayLike<ArrayLike<number>>;
					if (Array.isArray(values[0]) || ArrayBuffer.isView(values[0])) {
						// 従来のmakeStructuredViewと同じく、vec3の行は4要素間隔で配置する。
						// 平坦な入力ではpaddingも含む配列をそのまま受け取る。
						const rows = values as ArrayLike<ArrayLike<number>>;
						const stride = rows[0].length === 3 ? 4 : rows[0].length;
						for (let index = 0; index < rows.length; index++) view.set(rows[index], index * stride);
					} else {
						view.set(values as ArrayLike<number>);
					}
				}
			};
		}
		if (viewLayout.kind === 'array') {
			const writers = viewLayout.elements.map(createWriter);
			return value => {
				if (value == null) return;
				(value as unknown[]).forEach((item, index) => writers[index](item));
			};
		}
		const writers = new Map(Object.entries(viewLayout.fields).map(([name, field]) => [name, createWriter(field)]));
		return value => {
			if (value == null) return;
			for (const [name, item] of Object.entries(value)) writers.get(name)?.(item);
		};
	}

	return { arrayBuffer, set: createWriter(layout.view) };
}
