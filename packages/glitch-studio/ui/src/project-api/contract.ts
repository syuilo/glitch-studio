import * as z from 'zod';

/** CommandとQueryが公開する契約。通信方式やAiScriptの値表現は含めない。 */
export type ProjectApiContract<InputSchema extends z.ZodType = z.ZodType, ResultSchema extends z.ZodType = z.ZodType> = {
	description: string;
	examples: readonly string[];
	inputSchema: InputSchema;
	resultSchema: ResultSchema;
};

export type ProjectApiReference = {
	name: string;
	kind: 'command' | 'query';
	description: string;
	argumentCount: number;
	examples: string[];
	inputSchema: z.core.JSONSchema.JSONSchema;
	resultSchema: z.core.JSONSchema.JSONSchema;
};

/**
 * API境界では型の矯正や未知フィールドの削除を行わない。スキーマのparse結果を
 * 使うと、既存のドメイン定義に含まれる値が黙って失われるため、検証後も元の値を返す。
 * このため契約にはcoerce・transform・defaultなど値を変換するスキーマを使わない。
 */
export function parseProjectApiValue<Schema extends z.ZodType>(schema: Schema, value: unknown, context: string): z.output<Schema> {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		const details = new Set<string>();
		const collect = (issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[] = []) => {
			for (const issue of issues) {
				// Bindingなどのunionを単にInvalid inputと返すと、修正すべき引数が
				// 分からない。枝の具体的なエラーを示しつつ、再帰定義での出力量は抑える。
				if (details.size >= 8) return;
				const path = [...prefix, ...issue.path];
				if (issue.code === 'invalid_union' && issue.errors.length > 0) {
					for (const branch of issue.errors) collect(branch, path);
				} else {
					details.add(`${path.length === 0 ? '$' : path.map(String).join('.')}: ${issue.message}`);
				}
			}
		};
		collect(parsed.error.issues);
		throw new Error(`${context}: ${[...details].join('; ')}`);
	}
	return value as z.output<Schema>;
}

/** 定義やキャッシュを呼び出し元から書き換えられないよう、取得ごとに資料を生成する。 */
export function describeProjectApi(name: string, kind: ProjectApiReference['kind'], argumentCount: number, contract: ProjectApiContract): ProjectApiReference {
	return {
		name, kind, argumentCount, description: contract.description, examples: [...contract.examples],
		inputSchema: z.toJSONSchema(contract.inputSchema, { io: 'input' }),
		resultSchema: z.toJSONSchema(contract.resultSchema, { io: 'input' }),
	};
}
