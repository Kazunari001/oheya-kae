# 依存更新

Dependabotはルートのnpm依存（package.json / package-lock.json）と
`.github/workflows/`で使うGitHub Actionsを毎週確認します。
更新先は開発中の`feature/v1.1.0`、同時に開くPRは各エコシステム5件までです。
リリース系列を切り替えるときは両方のtarget-branchを変更してください。

Issue #22のCIを先にマージすると、更新PRでもlint、単体・CLIテスト、
Chromeのオフライン表示、配布確認が実行されます。
更新の自動マージは設定しません。破壊的変更・ライセンス・表示の差分を
確認してからマージしてください。

Dependabotの設定はデフォルトブランチ上で有効になります。
このPRを開発ブランチにマージしただけでは、定期実行はまだ始まりません。
リリース時に設定とCIをデフォルトブランチにも反映してください。
Settings → Code securityのDependabot version updatesから実行状態と
更新ジョブのログを確認し、最初の更新PRにCIが付くことを確認してください。
まだ生成されていない更新PRのCI成功は、設定追加だけでは確認できません。

設定値は[GitHubの公式リファレンス](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
に従います。target-branchを指定した更新は通常のバージョン更新が対象で、
デフォルトブランチに対するセキュリティ更新の設定とは別です。
