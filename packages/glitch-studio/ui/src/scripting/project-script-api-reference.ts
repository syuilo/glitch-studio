import { COMMAND_DEFS } from '../commands.ts';
import { describeProjectApi } from '../project-api/contract.ts';
import { SCRIPT_COMMAND_NAMES } from './script-command-names.ts';
import { PROJECT_SCRIPT_QUERY_DEFINITIONS } from './project-script-queries.ts';
import type { ProjectApiContract, ProjectApiReference } from '../project-api/contract.ts';

export type ProjectScriptApiSummary = Pick<ProjectApiReference, 'name' | 'kind' | 'description' | 'argumentCount'>;

// 公開リストの追加時に契約の付け忘れを型エラーにする。内部専用Commandには
// Blobや取り込み用データがあり、公開APIの契約を一律に要求しない。
const publicCommands: Record<typeof SCRIPT_COMMAND_NAMES[number], ProjectApiContract> = COMMAND_DEFS;

function entries(): { name: string; kind: ProjectApiReference['kind']; argumentCount: number; contract: ProjectApiContract }[] {
	return [
		...SCRIPT_COMMAND_NAMES.map(name => ({ name: `Command:${name}`, kind: 'command' as const, argumentCount: 1, contract: publicCommands[name] })),
		...Object.entries(PROJECT_SCRIPT_QUERY_DEFINITIONS).map(([name, definition]) => ({ name, kind: 'query' as const, argumentCount: definition.argumentCount, contract: definition })),
	];
}

/** 名前・用途だけを返し、巨大な再帰スキーマを検索結果へ毎回含めない。 */
export function searchProjectScriptApi(query: string): ProjectScriptApiSummary[] {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term.length > 0);
	return entries().filter(entry => {
		const text = `${entry.name} ${entry.contract.description}`.toLowerCase();
		return terms.every(term => text.includes(term));
	}).map(entry => ({ name: entry.name, kind: entry.kind, argumentCount: entry.argumentCount, description: entry.contract.description }));
}

/** 将来のMCPでも同じ実行中バージョンの資料を取得できる、通信方式に依存しない入口。 */
export function getProjectScriptApiReference(name: string): ProjectApiReference {
	const entry = entries().find(candidate => candidate.name === name);
	if (entry == null) throw new Error(`Unknown project API: ${name}`);
	return describeProjectApi(entry.name, entry.kind, entry.argumentCount, entry.contract);
}
