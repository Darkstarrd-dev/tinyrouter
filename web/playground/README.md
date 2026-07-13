# TinyRouter Playground

Playground 的 canonical 前后端架构文档位于：

- [`docs/playground-architecture.md`](../../docs/playground-architecture.md)

后续设计、排障和评审请先读取该文档，再按其中“源码锚点”核对本次变更涉及的代码。

当前实现已经拆分为多个 `pg-*.js` 文件；`static-pg/playground.js` 只保留兼容说明，不再是主模块。实际加载顺序以 `web/static/index.html` 为准，静态路由白名单以 `internal/api/router.go` 的 `pgJSFiles` 为准。
