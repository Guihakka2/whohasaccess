# whohasaccess

[English](README.md) · [Português](README.pt-BR.md) · 日本語

昨年の外注先がまだ admin 権限を持っている。書き込み可能なデプロイキーが 200 日使われていない。Webhook が push イベントを暗号化なしの http で送っている。**whohasaccess** は、自分が所有するすべてのリポジトリからこうした問題を数秒で見つけます。何も変更しません。

```bash
npx @guihakka2/whohasaccess                 # 所有する全リポジトリ
npx @guihakka2/whohasaccess --org my-company
```

- **外部コラボレーター**：admin は高、書き込みは中
- **保留中の招待**：7 日以上前のもの
- **デプロイキー**：書き込み可能なキー、90 日以上未使用のキー（`--stale`）
- **Webhook**：https でない、TLS 検証無効、失敗中、無効（URL はホスト名のみ表示。パスには秘密情報が含まれることが多いため）
- **Organization**：2FA 未設定のメンバー、オーナー、全リポジトリに書き込みできる GitHub App

**AI エージェントから使う（MCP）：** `whohasaccess --mcp` で監査を [MCP](https://modelcontextprotocol.io) サーバーとして起動し、エージェントに「誰がまだリポジトリにアクセスできる？」と聞けます。読み取り専用（GET のみ）、トークンは返さず、結果は「指示ではなくデータ」として明示されます。

```bash
claude mcp add whohasaccess -- npx -y @guihakka2/whohasaccess --mcp
```

GitHub CLI のログイン（`gh auth login`）または `GH_TOKEN` を使用。**読み取り専用**（GET リクエストのみ）で、トークンは表示しません。オプション：`--org`、`--all`、`--fail-on`、`--stale`、`--json`。セキュリティは [SECURITY.md](SECURITY.md) を参照。
