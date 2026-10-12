export type ValidationDiagnostic = {
	code: string;
	message: string;
	path?: readonly (string | number)[];
};

/** 診断の更新は検証単位ごとに行う。描画時には一覧を走査せず件数だけを読む。 */
export class ValidationDiagnostics {
	private readonly units = new Map<string, readonly ValidationDiagnostic[]>();
	public errorCount = 0;

	set(key: string, diagnostics: readonly ValidationDiagnostic[]) {
		this.errorCount -= this.units.get(key)?.length ?? 0;
		if (diagnostics.length === 0) this.units.delete(key);
		else this.units.set(key, diagnostics);
		this.errorCount += diagnostics.length;
	}

	clear() { this.units.clear(); this.errorCount = 0; }
	get firstMessage(): string | null { return this.units.values().next().value?.[0]?.message ?? null; }
	get entries() { return [...this.units].map(([unit, diagnostics]) => ({ unit, diagnostics })); }
}

/** 接続情報だけを走査する。値・クリップ・式の評価とは独立した検証。 */
export function inspectReferenceGraph(graph: ReadonlyMap<string, readonly string[]>): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	const completed = new Set<string>();
	const visiting = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id)) {
			diagnostics.push({ code: 'reference.cycle', message: `Circular reference: ${id}`, path: [id] });
			return;
		}
		if (completed.has(id)) return;
		visiting.add(id);
		for (const source of graph.get(id) ?? []) {
			if (!graph.has(source)) diagnostics.push({ code: 'reference.missing', message: `Referenced object not found: ${source}`, path: [id] });
			else visit(source);
		}
		visiting.delete(id);
		completed.add(id);
	};
	for (const id of graph.keys()) visit(id);
	return diagnostics;
}
