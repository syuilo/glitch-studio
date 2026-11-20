export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;

	if (a === null) return b === null;
	if (a === undefined) return b === undefined;
	if (b === null) return false;
	if (b === undefined) return false;

	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	} else if (a instanceof Map && b instanceof Map) {
		if (a.size !== b.size) return false;
		for (const [k, v] of a) {
			if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
		}
		return true;
	} else if (((typeof a) === 'object') && ((typeof b) === 'object')) {
		if (Array.isArray(a) !== Array.isArray(b) || (a instanceof Map) !== (b instanceof Map)) return false;
		const aks = Object.keys(a);
		const bks = Object.keys(b);
		if (aks.length !== bks.length) return false;
		for (let i = 0; i < aks.length; i++) {
			const k = aks[i];
			if (!Object.hasOwn(b, k) || !deepEqual(Reflect.get(a, k), Reflect.get(b, k))) return false;
		}
		return true;
	}

	return false;
}
