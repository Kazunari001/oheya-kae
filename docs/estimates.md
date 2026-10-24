# 推定値の修正と確認履歴

```sh
node bin/oheya-kae.js furniture update --id shelf --width 1200 --status estimated --note "既知の本の幅との比率"
node bin/oheya-kae.js furniture move --id shelf --x 1500 --status estimated --note "配置プレビュー"
node bin/oheya-kae.js object update --id clock --y 1500 --status estimated --note "画像から仮置き"
node bin/oheya-kae.js furniture update --id shelf --width 1180 --status confirmed --note "メジャーで実測"
node bin/oheya-kae.js furniture update --id shelf --confirm width
```

room update、room opening update、furniture update/move、object updateで
`--status confirmed|estimated|image|unknown`を使えます。
既定はconfirmedです。confirmed以外では`--note`が必要で、`--confirm`との併用は拒否します。
寸法のnullはunknownのままです。unknown状態に数値を持たせて仮表示することもできます。
履歴は元のunknown/null、モデル値、仮値、人の確認・再修正を区別します。
本体による一律の寸法補完は行いません。

