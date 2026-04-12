# @uni_toolkit/vite-plugin-component-insight

一个用于 uni-app Vue3 项目的 Vite 插件，用于分析组件被哪些页面使用、使用了多少次，并结合主包与分包关系给出简洁的中文提示。

> [!TIP]
> Node.js >= 18.0.0

## 功能特性

- 分析组件被哪些页面使用
- 基于构建产物中的 usingComponents 统计组件依赖次数，包含嵌套组件链路
- 结合主包和分包信息生成简洁中文提示
- 输出 JSON 和 Markdown 两份报告，便于查看和二次处理
- 兼容 uni-app Vue3 小程序构建流程，支持 easycom 解析结果

## 安装

```bash
npm install @uni_toolkit/vite-plugin-component-insight -D
# 或
pnpm add @uni_toolkit/vite-plugin-component-insight -D
# 或
yarn add @uni_toolkit/vite-plugin-component-insight -D
```

## 使用方法

```ts
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import componentInsight from '@uni_toolkit/vite-plugin-component-insight';

export default defineConfig({
  plugins: [
    componentInsight(),
    uni(),
  ],
});
```

插件会在小程序构建结束后，在项目根目录默认生成以下文件：

- logs/component-insight-report.json
- logs/component-insight-report.md

## 配置项

```ts
interface VitePluginComponentInsightOptions {
  reportJsonPath?: string;
  reportMarkdownPath?: string;
  enableSuggestions?: boolean;
  logToConsole?: boolean;
}
```

- reportJsonPath: 自定义 JSON 报告输出路径
- reportMarkdownPath: 自定义 Markdown 报告输出路径
- enableSuggestions: 是否生成提示，默认开启

## 输出说明

报告会包含以下信息：

- 组件路径
- 组件所属包范围，主包或具体分包
- 总使用次数
- 使用该组件的页面列表
- 基于主包和分包关系的中文提示

常见建议包括：

- 组件只被单一分包使用时，建议迁移到对应分包
- 组件被主包和多个分包共用时，建议保留在公共位置
- 组件只在单页少量使用时，建议评估是否需要保持独立组件

## 注意事项

1. 当前分析完全基于 uni-app 小程序构建产物中的 JSON 文件和 usingComponents 信息，因此只在 mp- 平台构建时生效。
2. 报告中的使用次数指 usingComponents 依赖引用次数，不是模板标签的真实渲染次数。
3. 子包根目录通过 @dcloudio/uni-cli-shared 提供的方法获取。
4. 组件依赖会递归累加嵌套组件，因此可以反映页面最终依赖链路。
5. 如果某些组件不经过 usingComponents 产出，报告中不会纳入统计。

## 许可证

[MIT](/LICENSE)