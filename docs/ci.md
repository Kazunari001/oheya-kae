# 通常の変更の検証

`.github/workflows/ci.yml`は全ブランチへのpush、全PRと手動実行で動きます。
実行者の制限はなく、DependabotやforkからのPRも同じ検証対象です。
読み取り権限のみを使い、公開用の認証情報は使用しません。

GitHubのUbuntu・Windows・macOSホストランナーでNode.js 22、24の
全6組み合わせを検証します。`package.json`の下限はNode.js 22です。
各ジョブはnpm ci、lint、単体・CLIテスト、demo生成、Google Chromeでの
オフライン表示、実際のtarballインストール確認を順に実行します。
Chromeのみをサポートし、Linuxでは依存ライブラリとともに導入します。
WindowsとmacOSではホストイメージに含まれるChromeを使用します。
パッケージインストール時はnpmレジストリへの通信が必要です。

CIは検証だけを行います。npmへの公開はrelease.ymlの役割です。
必須チェックの設定はGitHubのブランチ保護で別途指定してください。
