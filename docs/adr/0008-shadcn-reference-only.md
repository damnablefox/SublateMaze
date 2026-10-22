# ADR-0008：shadcn/ui 仅作设计参考，不引入 Tailwind 与 Radix

- 日期：2026-10-22
- 状态：已接受

## 背景

专业集蓝图编辑器需要右键菜单、弹层、表单与危险操作确认。shadcn/ui 提供了成熟的交互结构与视觉规范，但其实现依赖 Tailwind CSS、Radix UI 与 class-variance-authority。

现有渲染端使用纯 CSS + 设计 token（`theme/tokens.css`），组件样式集中在 `styles.css`，没有 Tailwind 构建链。

## 决策

1. 将 shadcn/ui 仓库稀疏克隆到工作区 `refs-shadcn-ui`，仅作为交互与视觉参考；
2. 不引入 Tailwind、Radix 或 shadcn CLI；
3. 自研轻量菜单与弹层组件，沿用现有设计 token，结构参考 shadcn：
   - 菜单分组、分隔线、危险项、键盘关闭；
   - 弹层遮罩、焦点管理、按钮层级。

## 理由

- 引入 Tailwind 会形成两套样式体系，增加维护成本与构建复杂度；
- 现有 token 已覆盖颜色、圆角、间距与状态，足以实现所需组件；
- 自研组件体积小，避免为少量组件引入整套依赖；
- 视觉规范可以借鉴，但不必复制实现。

## 后果

- 菜单与弹层的可访问性由本项目自行保障，需要在实现中显式处理 Esc、点击外部关闭与焦点可见；
- 后续若全面迁移到 Tailwind，需要单独立项并统一 token；
- 参考仓库需要与 `refs-zotero`、`refs-unrealengine-5.8` 一样保留在工作区同级目录，不纳入 SublateMaze 仓库。
