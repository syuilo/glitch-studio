/** 参照情報だけを走査する。値の編集では呼ばず、接続関係が変わったときに使う。 */
export function findDependencyCycle(dependencies: ReadonlyMap<string, readonly string[]>): string[] | null {
	const complete = new Set<string>();
	const path: string[] = [];
	const active = new Set<string>();
	const visit = (id: string): string[] | null => {
		if (active.has(id)) return [...path.slice(path.indexOf(id)), id];
		if (complete.has(id)) return null;
		active.add(id);
		path.push(id);
		for (const dependency of dependencies.get(id) ?? []) {
			const cycle = visit(dependency);
			if (cycle) return cycle;
		}
		path.pop();
		active.delete(id);
		complete.add(id);
		return null;
	};
	for (const id of dependencies.keys()) {
		const cycle = visit(id);
		if (cycle) return cycle;
	}
	return null;
}
