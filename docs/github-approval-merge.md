# 自分名義のPRを承認してマージする

GitHubではPR作成者が自分のPRにApproveできないため、承認コメントを使う。
`Kazunari001`（ユーザーID `130190029`）がPRのConversationに次の形式で
**新しいコメント**を投稿すると、GitHub ActionsがmainへSquashマージする。

```text
/merge <PRの最新コミットの40桁SHA>
```

PRのCommitsタブで最新コミットの完全なSHAをコピーする。
ローカルでそのPRのブランチを開いている場合は `git rev-parse HEAD` でも取得できる。
山括弧は入力しない。短縮SHA、コメントの編集、通常のIssueへの投稿は対象外。

## マージ条件

- 承認者と投稿イベントの送信者が上記のユーザーIDである。
- 投稿したコメントが実行前に編集・削除されていない。
- PRがOpenでDraftではなく、マージ先がこのリポジトリのmainである。
- 承認したSHAがPRの現在の先頭コミットと一致する。
- GitHubのマージ状態がcleanであり、競合やチェックによる問題がない。
- マージAPIに同じSHAを渡し、検証後の更新もGitHub側で拒否する。

失敗時はActionsの「Merge on owner approval」で理由を確認する。
チェック待ちや競合がある場合は解消後に新しくコメントする。
新しいコミットを追加した場合は、その新しいSHAを確認して承認し直す。
自動的に待機・再試行して後のコミットをマージすることはない。

## 運用上の範囲

これはコメントを合図にしたマージ処理であり、GitHubのApproveレビューや
各PRの「Enable auto-merge」を使う方式ではない。自分のPRを承認できなくなるため、
必須レビュー数は追加しない。手動マージやmainへの直接pushを禁止する設定でもない。

ワークフローはデフォルトブランチに置く必要がある。
実行するのはイベント時点のデフォルトブランチのスクリプトだけで、PR側のコードは
チェックアウトも実行もしない。認証には短期間有効な `GITHUB_TOKEN` を使用する。
PATなどの追加シークレットは不要。既存のブランチ保護ルールは迂回しない。

GitHubにCIワークフローがなければ、この処理だけでnpmテストが実行されることはない。
必須テストを設ける際は、CIとブランチの必須ステータスチェックも設定する。
`GITHUB_TOKEN` によるマージでは、通常そのpushを契機とする別のActionsは起動しない。
マージ後のデプロイなどを追加するときは、別途トリガーを設計する。

## 参考

- [GitHub: PR作成者は自分のPRをApproveできない](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)
- [GitHub: issue_commentイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issue_comment)
- [GitHub: SHAを指定したマージAPI](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)
