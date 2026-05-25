# MirrorTool

使用 Bun + TypeScript 同步多个 GitHub 仓库的 Release assets 到 SiFli 内部对象存储。

## 功能

- 支持在 `mirror.config.json` 中配置多个 GitHub 仓库。
- 支持手工指定必须同步的 `manualTags`。
- 所有同步目标都通过 `manualTags` 手工管理。
- 同步成功后自动更新 `master` 分支上的 `syncedTags`。
- COS 路径固定为 `github_assets/<org>/<repo>/releases/download/<tag>/<asset-name>`。

## 配置文件

根目录的 `mirror.config.json` 格式如下：

```json
{
  "version": 1,
  "repos": [
    {
      "owner": "OpenSiFli",
      "repo": "crosstool-ng",
      "manualTags": [
        "14.2.0-20250221"
      ],
      "syncedTags": [],
      "flushUrl": null
    }
  ]
}
```

字段说明：

- `manualTags`: 手工指定、必须补同步的 tag。
- `syncedTags`: 已成功同步到 COS 的 tag，由工作流自动维护。
- `flushUrl`: 可选 CDN 刷新路径；不需要时填 `null`。

## 工作流

工作流文件为 `.github/workflows/mirror-sync.yml`，触发方式：

- `push` 到 `master`：补同步 `manualTags` 中尚未同步的 tag。
- `workflow_dispatch`：手工触发，仅处理 `manualTags` 中尚未同步的 tag。

## Secrets

需要在 GitHub 仓库中配置以下 Secrets：

- `COS_DOWNLOAD_SECRET_ID`
- `COS_DOWNLOAD_SECRET_KEY`
- `COS_DOWNLOAD_REGION`
- `COS_DOWNLOAD_BUCKET`

可选：

- `GH_TOKEN`: 如果需要更高 GitHub API 额度或访问私有仓库，可额外配置。未提供时默认使用 `GITHUB_TOKEN`。

## 本地使用

```bash
bun install
bun run typecheck
bun test
```

生成计划：

```bash
bun run src/cli.ts plan --config mirror.config.json --mode push
```

下载单个 release 的全部资产到本地：

```bash
bun run src/cli.ts download \
  --owner OpenSiFli \
  --repo crosstool-ng \
  --tag 14.2.0-20250221 \
  --output-root .mirror-work/assets
```

把成功同步的 tag 写回配置：

```bash
bun run src/cli.ts apply-state \
  --config mirror.config.json \
  --tasks-json '[{"owner":"OpenSiFli","repo":"crosstool-ng","tag":"14.2.0-20250221","flushUrl":null,"reason":"manual"}]' \
  --write
```
