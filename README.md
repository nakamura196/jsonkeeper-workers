# jsonkeeper-workers

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1](https://img.shields.io/badge/Cloudflare-D1-0072CE?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A small, edge-native reimplementation of [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) on **Cloudflare Workers + D1**, focused on the subset of the API that the [IIIF Curation Viewer](https://github.com/IIIF-Japan/iiif-curation-viewer) actually uses for export. Written in TypeScript with [Hono](https://hono.dev/) and [jose](https://github.com/panva/jose) — no Firebase Admin SDK, no service-account key.

---

## 日本語

### これは何か

[IIIF Curation Viewer](https://github.com/IIIF-Japan/iiif-curation-viewer) のキュレーション保存先である [JSONkeeper](https://github.com/IllDepence/JSONkeeper)（Python/Flask）を、Cloudflare Workers + D1 上で TypeScript で書き直したものです。Viewer が実際に叩く I/F に絞って実装することで、本家の機能の一部だけを最小コストで提供します。

詳しい設計判断やアップストリームとの差分は、Zenn 記事 [JSONkeeper を Cloudflare Workers + D1 で書き直した記録](https://zenn.dev/) を参照してください。

### 主な特徴

- **Firebase Admin SDK 不要**: ID トークンの RS256 検証を `jose` + Google x509 公開鍵だけで行います。サービスアカウント鍵をサーバに置く必要がありません。
- **D1 (SQLite-on-edge)** にドキュメントを保存。テーブルは `documents` 1 つ。マイグレーションは `wrangler d1 migrations apply` で適用。
- **JSON-LD `@id` の自動書き換え**: トップレベルとネストノードを再帰的に処理し、保存先 URL ベースの `@id` に置換します（ネストは `<docUrl>#frag-<n>`）。
- **依存は `hono` と `jose` のみ**。TypeScript 約 360 行に収まっています。
- **CORS は Viewer 互換**: `X-Firebase-ID-Token` / `X-Access-Token` / `X-Unlisted` を `allowHeaders` に、`Location` を `exposeHeaders` に明示。

### エンドポイント

| Method | Path | 認可 | 概要 |
|---|---|---|---|
| GET | `/` | 不要 | サーバ情報（提供エンドポイント一覧） |
| POST | `/api` | 任意（Viewer は匿名 POST も可） | JSON ドキュメントを新規保存。`Location` ヘッダで保存先 URL を返却 |
| GET | `/api/:id` | 不要 | ドキュメント取得 |
| PUT | `/api/:id` | 必須（owner_uid 一致） | ドキュメント上書き |
| PATCH | `/api/:id` | 必須（owner_uid 一致） | `{"unlisted": true/false}` のみ受付 |
| DELETE | `/api/:id` | 必須（owner_uid 一致） | ドキュメント削除 |
| GET | `/api/userdocs` | 必須 | 自分が所有するドキュメント一覧 |
| GET | `/as/collection.json` | 不要 | Activity Streams 形式の OrderedCollection（`unlisted = 0` のものだけ） |

認可ヘッダは `X-Firebase-ID-Token: <token>` または `Authorization: Bearer <token>` を受け付けます。

### セットアップ

事前に Cloudflare アカウントと、`securetoken.google.com/<project-id>` を発行する Firebase Authentication プロジェクトが必要です。

```bash
# 1. clone
git clone https://github.com/nakamura196/jsonkeeper-workers.git
cd jsonkeeper-workers
npm install

# 2. 設定ファイルを準備
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars

# 3. wrangler ログイン
npx wrangler login

# 4. D1 データベース作成（返ってきた database_id を控える）
npx wrangler d1 create jsonkeeper

# 5. wrangler.toml と .dev.vars を編集
#    - FIREBASE_PROJECT_ID: 自分の Firebase プロジェクト ID
#    - database_id:         手順 4 で発行された UUID

# 6. マイグレーション適用
npx wrangler d1 migrations apply jsonkeeper --local    # ローカル開発用
npx wrangler d1 migrations apply jsonkeeper --remote   # 本番用

# 7. ローカル起動
npm run dev    # → http://127.0.0.1:8787

# 8. デプロイ
npm run deploy
# → https://jsonkeeper.<your-cf-subdomain>.workers.dev
```

### スモークテスト

`test/smoke.sh` は 4 ケースの最小チェック（root / 匿名 POST / GET 取得 / Curation の `@id` 書き換え）を行います。

```bash
# ローカル
BASE=http://127.0.0.1:8787 ./test/smoke.sh

# 本番
BASE=https://jsonkeeper.<your-cf-subdomain>.workers.dev ./test/smoke.sh
```

### 設定項目

| 項目 | 場所 | 役割 |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `wrangler.toml [vars]` / `.dev.vars` | JWT の `iss` / `aud` 検証に使用 |
| `REWRITE_TYPES` | 同上 | `@id` を書き換える対象の JSON-LD `@type` URI（カンマ区切り） |
| `database_id` | `wrangler.toml [[d1_databases]]` | `wrangler d1 create` で発行された UUID |

いずれもシークレットではないため `wrangler.toml` に書きますが、利用者ごとに値が異なるため、公開リポジトリ側ではプレースホルダ化して `wrangler.toml.example` として配布しています。実体の `wrangler.toml` と `.dev.vars` は `.gitignore` 済みです。

### アップストリームとの差分

`X-Access-Token`（自前トークン）、`/<id>/status` PATCH、Activity Stream ページネーション、garbage collection、Range サブ URL (`/<id>/range<n>`) は未実装です。Viewer から見える挙動は機能十分ですが、本家互換が要件の場合は [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) を直接利用してください。

### ライセンス

[MIT](LICENSE)。アップストリーム [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) に敬意を込めて。

---

## English

### What this is

A Cloudflare Workers + D1 reimplementation of [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) (Python/Flask), scoped to the subset of the API that [IIIF Curation Viewer](https://github.com/IIIF-Japan/iiif-curation-viewer) actually uses for its export workflow. Written in TypeScript with [Hono](https://hono.dev/) and [jose](https://github.com/panva/jose).

### Highlights

- **No Firebase Admin SDK required.** Firebase ID tokens are verified with `jose` against Google's public x509 certificates, so there is no service-account key on the server.
- **D1 (SQLite-on-edge)** stores documents in a single `documents` table. Migrations are applied via `wrangler d1 migrations apply`.
- **JSON-LD `@id` rewriting** for both the top-level node and nested matching nodes (nested IDs become `<docUrl>#frag-<n>`).
- **Two runtime dependencies** (`hono`, `jose`). The TypeScript source is roughly 360 lines.
- **CORS preset compatible with the Viewer**: `X-Firebase-ID-Token`, `X-Access-Token`, `X-Unlisted` are in `allowHeaders`; `Location` is in `exposeHeaders`.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | none | Service metadata (list of endpoints) |
| POST | `/api` | optional | Create a document; returns `Location` header |
| GET | `/api/:id` | none | Retrieve a document |
| PUT | `/api/:id` | required (owner) | Replace a document |
| PATCH | `/api/:id` | required (owner) | Toggle `{ "unlisted": bool }` |
| DELETE | `/api/:id` | required (owner) | Delete a document |
| GET | `/api/userdocs` | required | List the caller's documents |
| GET | `/as/collection.json` | none | Activity Streams `OrderedCollection` of listed documents |

Tokens are accepted as either `X-Firebase-ID-Token: <token>` or `Authorization: Bearer <token>`.

### Setup

You'll need a Cloudflare account and a Firebase Authentication project (any project that issues tokens under `securetoken.google.com/<project-id>`).

```bash
git clone https://github.com/nakamura196/jsonkeeper-workers.git
cd jsonkeeper-workers
npm install

cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars

npx wrangler login
npx wrangler d1 create jsonkeeper
# copy the returned database_id into wrangler.toml
# set FIREBASE_PROJECT_ID in wrangler.toml and .dev.vars

npx wrangler d1 migrations apply jsonkeeper --local
npx wrangler d1 migrations apply jsonkeeper --remote

npm run dev      # http://127.0.0.1:8787
npm run deploy   # https://jsonkeeper.<your-cf-subdomain>.workers.dev
```

### Smoke test

`test/smoke.sh` covers four cases: root, anonymous POST, round-trip GET, and Curation `@id` rewrite.

```bash
BASE=http://127.0.0.1:8787 ./test/smoke.sh
BASE=https://jsonkeeper.<your-cf-subdomain>.workers.dev ./test/smoke.sh
```

### Configuration

| Key | Where | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `wrangler.toml [vars]` / `.dev.vars` | Verifies `iss` / `aud` on incoming JWTs |
| `REWRITE_TYPES` | same | Comma-separated JSON-LD `@type` URIs whose `@id` should be rewritten |
| `database_id` | `wrangler.toml [[d1_databases]]` | UUID returned by `wrangler d1 create` |

None of these are secrets, but they are per-deployment, so the repo ships `wrangler.toml.example` and `.dev.vars.example` with placeholders. Both real files are `.gitignore`d.

### Differences from upstream

The following upstream features are not implemented: `X-Access-Token` (self-managed tokens), `/<id>/status` PATCH endpoint, Activity Stream pagination, garbage collection, and Range sub-URLs (`/<id>/range<n>`). If you need full upstream compatibility, run [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) directly.

### Acknowledgements

This project is a reimplementation inspired by [IllDepence/JSONkeeper](https://github.com/IllDepence/JSONkeeper) and is intended as a lightweight, edge-deployable alternative for IIIF Curation Viewer's export target. All credit for the original design goes upstream.

### License

[MIT](LICENSE)
