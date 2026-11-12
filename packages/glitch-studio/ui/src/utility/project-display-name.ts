/** 未設定の名前は表示時だけ補い、プロジェクト情報や最近使ったプロジェクトの記録には書き戻さない。 */
export function getProjectDisplayName(projectName: string, projectFileName: string | null): string {
	if (projectName !== '') return projectName;
	return projectFileName != null && projectFileName !== '' ? projectFileName : '(Unsaved)';
}
