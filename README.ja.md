# seigo

[English](README.md) | 日本語

構造化ログの簡易 Web ビュアーです。

- 特徴
    - ログ取得元
        - journald (`journalctl` 経由)
        - SSH 経由の journald
    - ログのクエリ
        - plain (無加工)
        - [jaq](https://github.com/01mf02/jaq) (`jq` のクローン)
    - ブックマーク可能なログのクエリ

## インストール

TOOD

## 使い方

```
Seigo 🐟

Usage:
  seigo [flags]
  seigo [command]

Available Commands:
  collect     Collect & Dump in terminal.
  completion  Generate the autocompletion script for the specified shell
  help        Help about any command

Flags:
  -C, --config string        Config file path. (default "~/.config/seigo/config.toml")
  -h, --help                 help for seigo
  -l, --listen-addr string   Listen Address. (default "localhost")
  -p, --port uint16          Listen Port. (default 8080)
  -s, --stdin                Read logs from stdin mode. If this flag is specified, --config is ignored.

Use "seigo [command] --help" for more information about a command.
```

設定ファイルを配置し `seigo` を実行することで、サーバーとして起動します。その後、ブラウザでアクセス (デフォルトは [http://localhost:8080/](http://localhost:8080/) できます。

## 設定ファイル

例

```toml
[[collection]]
name = "default"
type = "journald"
#[[collection.match]]
#KEY = "VALUE"

[[collection]]
name = "stub"
type = "journald"
journalctl-cmd = "./stub/journalctl"

[[collection]]
name = "ssh"
type = "ssh+journald"
hostname = "localhost"
#port = 0
#username = ""
#identity-file = ""
#identity-agent = ""
#global-known-hosts-file = ""
#user-known-hosts-file = ""
hostkey-algorithms = ["ssh-ed25519"]
```

- `collection[]` ... ログ取得元
    - `name` ... ログ取得元の名前
    - `type` ... ログ取得元の型
    - その他の項目は `type` により異なる
        - `journald`
            - `no-docker-aware` ... `CONTAINER_PARTIAL_MESSAGE` フィールドを考慮しない (任意)
            - `match` ... `journalctl` に渡す `KEY=VALUE` (任意)
            - `journalctl-cmd` ... `journalctl` コマンドのパス (任意)
        - `ssh+journald`
            - `hostname` ... SSH 接続先ホスト名
            - `port` ... SSH 接続先ポート番号 (任意)
            - `username` ... SSH 接続の認証ユーザ (任意)
            - `identity-file` ... SSH 接続の認証で利用する SSH 鍵ファイルのパス (任意)
            - `identity-agent` ... SSH 接続の認証で利用する SSH エージェントのソケットパス (任意)
                - 未指定の場合は環境変数 `SSH_AUTH_SOCK` を参照する
            - `global-known-hosts-file` ... グローバルな `known_hosts` ファイルのパス (任意)
                - デフォルトは `/etc/ssh/known_hosts`
            - `user-known-hosts-file` ... ユーザ固有の `known_hosts` ファイルのパス (任意)
                - デフォルトは `~/.ssh/known_hosts`
            - `hostkey-algorithms` ... SSH サーバー鍵の検証で利用するアルゴリズム

## ビルド

- 必要ソフトウェア
    - Go (テスト済み 1.24)
    - Node.js (テスト済み 22.14)
    - Rust (テスト済み 1.85)

```bash
go generate ./internal/web
go build .
```

## 開発サーバー

下記コマンドで起動します。

```
make dev
```

## ライセンス

[MIT](LICENSE)
