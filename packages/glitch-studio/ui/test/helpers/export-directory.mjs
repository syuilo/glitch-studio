/** ディスクへ反映するcloseと、一時出力だけを破棄するabortを区別する保存先。 */
export function createExportDirectory(initial = null, beforeWrite = async () => {}) {
	let content = initial;
	let exists = initial != null;
	const events = [];
	const missing = () => new DOMException('Missing file', 'NotFoundError');
	const handle = {
		name: 'output.exr',
		async isSameEntry(other) { return other === handle; },
		async getFile() { if (!exists) throw missing(); return { size: content.byteLength }; },
		async createWritable() {
			let staged = new Uint8Array(0);
			return {
				async write({ data, position }) {
					events.push(['write', position]);
					await beforeWrite();
					if (position + data.byteLength > staged.byteLength) {
						const expanded = new Uint8Array(position + data.byteLength);
						expanded.set(staged); staged = expanded;
					}
					staged.set(data, position);
				},
				async close() { events.push(['close']); content = staged; },
				async abort() { events.push(['abort']); },
			};
		},
	};
	const directory = {
		async getFileHandle(_name, options) {
			if (!exists) {
				if (options?.create !== true) throw missing();
				exists = true; content = new Uint8Array(); events.push(['create']);
			}
			return handle;
		},
		async removeEntry() { events.push(['remove']); exists = false; content = null; },
	};
	return { directory, handle, events, get content() { return content; }, get exists() { return exists; } };
}
