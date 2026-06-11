<p align="center">
  <h1 align="center">🌉 IM Bridge</h1>
  <p align="center">スマートフォンからいつでも Claude と対話。13 種類の IM プラットフォームに対応し、ワンコマンドでデプロイできます。</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.2.1-blue" alt="version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="node">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
</p>

<p align="center">
  <a href="README.md">简体中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

---

## ワンコマンドデプロイ

```bash
curl -fsSL https://raw.githubusercontent.com/lpc0387/im-bridge/master/install.sh | bash
```

`http://SERVER_IP:81` を開き、設定ウィザードから設定して会話を開始します。

## 対応プラットフォーム

| プラットフォーム | 接続方式 | グローバル IP 必須 |
|------|----------|:----------:|
| 💼 WeCom / 企業微信 | Webhook コールバック | ✅ |
| 📱 個人 WeChat | iLink Bot API（公式、安全性重視） | ❌ |
| 🐦 Feishu | WebSocket | ❌ |
| 📌 DingTalk | Stream | ❌ |
| ✈️ Telegram | Long Polling | ❌ |
| 💬 Slack | Socket Mode | ❌ |
| 🎮 Discord | WebSocket | ❌ |
| 🟢 LINE | Webhook | ✅ |
| 📞 WhatsApp | Cloud API | ✅ |
| 🔒 Signal | REST API | ❌ |
| 🔮 Matrix | Sync API | ❌ |
| 🟦 Teams | Bot Framework | ❌ |
| 🔵 Google Chat | Webhook | ✅ |

## 主な機能

**会話機能**
- Claude API の直接呼び出し。ツール、MCP、Skill に対応し、最大 12 ターンのツール呼び出しが可能です。
- `@@パスワード コマンド` による Claude Code CLI パススルー。Git/Agent 操作を含むフル機能を利用でき、ターン数制限はありません。
- CLI セッション再開：`@@パスワード` だけで前回のセッションに復帰できます。`/new` で新規作成、`/clear` でクリアできます。
- Baidu、Bing、GitHub、CSDN、Juejin、Zhihu など 14+ の MCP 検索ツールを内蔵。
- Skill 拡張システム。動的作成、呼び出し、インポート、複数フォーマットへの自動適応に対応します。

**セッション管理**
- `/switch` による複数セッションの一覧表示と番号選択、`/new` による新規作成。
- 履歴の永続化とトークン使用量の統計。
- メッセージガード：タスク実行中の重複入力を検知し、「待機」または「新しいセッション」を選択できます。
- ツール実行状況や CLI コマンド追跡のリアルタイムフィードバック。
- CLI チェックポイント再開：停止した場合でも実行済みコンテキストを引き継いで再試行できます。

**アダプター監視**
- 長時間接続アダプターを監視し、連続失敗時にオフラインとしてマークします。
- オフラインのアダプターは 60 秒ごとに自動再接続されます。
- Web ダッシュボードで接続状態を確認し、手動再接続も可能です。

**Web ダッシュボード**（ポート 81）
- 概要：システム状態、アダプター、Agent、MCP ツール。
- アダプター：接続状態、エラー情報、ワンクリック再接続。
- MCP：ツール一覧、追加、削除。
- Skill：一覧、新規作成、編集、削除、インポート。Claude Code、Codex、Gemini、Cursor、Windsurf 形式の自動適応をサポートします。
- セッション：ユーザー別検索、会話詳細の確認、セッション削除。
- 設定ウィザード：13 プラットフォームのガイド付き設定。パラメータ説明、取得手順、必要に応じて QR ログインを提供します。
- 会話テスト：オンラインで会話動作を確認できます。
- モバイル対応レイアウト。

## コマンド

**セッション管理**

| コマンド | 説明 |
|------|------|
| `/switch` | セッション一覧を表示し、番号で切り替えます |
| `/new` | 新しいセッションを作成します |
| `/clear` | 現在のセッションをクリアします |
| `/cost` | トークン使用量を表示します |
| `/turns` | 会話ターン数を表示します |

**システム**

| コマンド | 説明 |
|------|------|
| `/setup` | 対話式ウィザードでアダプターを設定します |
| `/agents` | Agent 一覧を表示します |
| `/adapters` | アダプター状態を表示します |
| `/help` | ヘルプを表示します |

**CLI パススルー**

| コマンド | 説明 |
|------|------|
| `@@パスワード コマンド` | サーバー上の Claude Code CLI を呼び出します |
| `@@パスワード` | 前回の CLI セッションに復帰します |
| `@@パスワード /new` | 新しい CLI セッションを強制的に開始します |
| `@@パスワード /clear` | 現在の CLI セッションをクリアします |
| `/cli-clear` | CLI セッション状態のみをクリアします |

## メッセージガード

タスク実行中に新しいメッセージを受信した場合：

```text
⏳ 「会話」を実行中です（5 秒経過）。完了までお待ちください。

返信：
1️⃣ 続けて待つ
2️⃣ 新しいセッションを開始
```

これにより、メッセージの滞留やタスク競合を防ぎます。

## アーキテクチャ

```text
Mobile IM ←→ IM server ←→ IM Bridge ←→ Claude API + MCP tools
                              ↓
                        Web dashboard :81
```

```text
src/
├── adapters/           # 13 個の IM アダプター（監視再接続、長文分割）
├── agents/             # AI Agent（無出力タイムアウト検出）
├── cron/               # 定期タスク
├── web/                # Web ダッシュボード
├── claude.js           # Claude API + tools、12 ターン制限
├── cli-passthrough.js  # CLI パススルー、無制限ターン、セッション/チェックポイント再開
├── session.js          # セッション管理
├── message-guard.js    # 同時入力制御
├── mcp-client.js       # MCP クライアント
└── index.js            # メインエントリ
scripts/
└── setup.js            # CLI 設定スクリプト
```

## 設定方法

**方法 1：Web ダッシュボード（推奨）**

`http://SERVER_IP:81` を開く → 設定ウィザード → プラットフォーム選択 → ガイドに従って入力 → 保存して自動再起動。

**方法 2：チャット内設定**

IM で `/setup` を送信 → プラットフォーム選択 → 項目を順番に入力 → 自動保存。

**方法 3：CLI スクリプト**

```bash
npm run setup          # 対話式設定
npm run setup:status   # 設定状態を表示
npm run setup:all      # 全プラットフォームを一括設定
```

**方法 4：手動編集**

```bash
cp .env.example .env
vim .env
pm2 restart im-bridge
```

## ライセンス

[MIT](LICENSE)
