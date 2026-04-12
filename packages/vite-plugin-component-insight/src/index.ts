import fs from 'node:fs';
import path from 'node:path';
import { parseJson, parseSubpackagesRootOnce } from '@dcloudio/uni-cli-shared';
import { isMiniProgram } from '@uni_toolkit/shared';
import type { PluginOption } from 'vite';

interface PageEntry {
  path: string;
  packageRoot: string;
  packageName: string;
}

interface OutputJsonRecord {
  jsonRelativePath: string;
  logicalPath: string;
  isComponent: boolean;
  usingComponents: Record<string, string>;
}

interface ComponentInsightItem {
  component: string;
  componentPackage: string;
  totalUsageCount: number;
  pageUsageCount: number;
  pages: Array<{
    page: string;
    packageName: string;
    usageCount: number;
  }>;
  suggestions: string[];
}

interface ComponentInsightReport {
  generatedAt: string;
  inputDir: string;
  outputDir: string;
  suggestionEnabled: boolean;
  summary: {
    pageCount: number;
    componentCount: number;
    reportedComponentCount: number;
  };
  components: ComponentInsightItem[];
}

export interface VitePluginComponentInsightOptions {
  reportJsonPath?: string;
  reportMarkdownPath?: string;
  reportJsonFile?: string;
  reportMarkdownFile?: string;
  enableSuggestions?: boolean;
  logToConsole?: boolean;
}

const DEFAULT_OPTIONS: Required<VitePluginComponentInsightOptions> = {
  reportJsonPath: 'logs/component-insight-report.json',
  reportMarkdownPath: 'logs/component-insight-report.md',
  reportJsonFile: 'logs/component-insight-report.json',
  reportMarkdownFile: 'logs/component-insight-report.md',
  enableSuggestions: true,
  logToConsole: true,
};

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

function stripJsonExtension(filePath: string) {
  return filePath.replace(/\.json$/i, '');
}

function resolveOutputPath(outputPath: string) {
  return path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseJson(content, true, path.basename(filePath)) as T;
}

function readPages(inputDir: string) {
  const pagesJsonPath = path.join(inputDir, 'pages.json');
  const pagesJson = readJsonFile<{
    pages?: Array<{ path: string }>;
    subPackages?: Array<{ root?: string; pages?: Array<{ path: string }> }>;
    subpackages?: Array<{ root?: string; pages?: Array<{ path: string }> }>;
  }>(pagesJsonPath);
  const platform = (process.env.UNI_PLATFORM || 'mp-weixin') as Parameters<typeof parseSubpackagesRootOnce>[1];
  const subPackageRoots = parseSubpackagesRootOnce(inputDir, platform).map((root) =>
    normalizeSlashes(root).replace(/^\/+|\/+$/g, ''),
  );

  const pages: PageEntry[] = [];
  for (const page of pagesJson?.pages ?? []) {
    if (!page.path) {
      continue;
    }
    pages.push({
      path: normalizeSlashes(page.path),
      packageRoot: '',
      packageName: 'main',
    });
  }

  const subPackages = [...(pagesJson?.subPackages ?? []), ...(pagesJson?.subpackages ?? [])];
  for (const subPackage of subPackages) {
    const root = normalizeSlashes(subPackage.root ?? '').replace(/^\/+|\/+$/g, '');
    if (!root) {
      continue;
    }

    for (const page of subPackage.pages ?? []) {
      if (!page.path) {
        continue;
      }
      pages.push({
        path: normalizeSlashes(path.posix.join(root, page.path)),
        packageRoot: root,
        packageName: `sub:${root}`,
      });
    }
  }

  return {
    pages,
    subPackageRoots,
  };
}

function listJsonFiles(dirPath: string, files: string[] = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listJsonFiles(absolutePath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function resolveUsingComponentPath(currentJsonRelativePath: string, componentRef: string, outputDir: string) {
  if (!componentRef || /^(plugin|ext):\/\//.test(componentRef)) {
    return null;
  }

  const cleanRef = componentRef.replace(/\.(json|vue|nvue|uvue)$/i, '');
  const resolvedAbsolutePath = cleanRef.startsWith('/')
    ? path.join(outputDir, cleanRef.slice(1))
    : path.resolve(path.dirname(path.join(outputDir, currentJsonRelativePath)), cleanRef);

  return normalizeSlashes(path.relative(outputDir, `${resolvedAbsolutePath}.json`));
}

function detectPackageName(filePath: string, subPackageRoots: string[]) {
  const normalized = normalizeSlashes(filePath);
  let matchedRoot = '';
  let matchedPackageName = 'main';

  for (const root of subPackageRoots) {
    if (!root) {
      continue;
    }
    const rootWithSlash = `${root}/`;
    if (normalized.startsWith(rootWithSlash) && root.length > matchedRoot.length) {
      matchedRoot = root;
      matchedPackageName = `sub:${root}`;
    }
  }

  return matchedPackageName;
}

function buildMarkdown(report: ComponentInsightReport) {
  const lines: string[] = [
    '# 组件分析报告',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 页面数量：${report.summary.pageCount}`,
    `- 组件数量：${report.summary.componentCount}`,
    `- 已分析组件数：${report.summary.reportedComponentCount}`,
    `- 提示开关：${report.suggestionEnabled ? '开启' : '关闭'}`,
    '- 统计说明：使用次数基于构建产物中 usingComponents 的依赖引用次数。',
    '',
  ];

  for (const item of report.components) {
    lines.push(`## ${item.component}`);
    lines.push('');
    lines.push(`- 所属分包：${item.componentPackage}`);
    lines.push(`- 总使用次数：${item.totalUsageCount}`);
    lines.push(`- 使用页面数：${item.pageUsageCount}`);
    lines.push('');
    lines.push('| 页面 | 分包 | 使用次数 |');
    lines.push('| --- | --- | --- |');
    for (const page of item.pages) {
      lines.push(`| ${page.page} | ${page.packageName} | ${page.usageCount} |`);
    }
    lines.push('');
    if (report.suggestionEnabled) {
      lines.push('### 提示');
      lines.push('');
      for (const suggestion of item.suggestions) {
        lines.push(`- ${suggestion}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function logSummary(report: ComponentInsightReport) {
  const summaryLines = [
    '[vite-plugin-component-insight] 分析完成',
    `页面数: ${report.summary.pageCount}`,
    `组件数: ${report.summary.componentCount}`,
    `已分析: ${report.summary.reportedComponentCount}`,
  ];
  console.info(summaryLines.join(' | '));

  for (const item of report.components.slice(0, 10)) {
    const packageNames = Array.from(new Set(item.pages.map((page) => page.packageName))).join(', ');
    console.info(
      `[vite-plugin-component-insight] ${item.component} | 使用次数=${item.totalUsageCount} | 页面数=${item.pageUsageCount} | 分包=${packageNames}`,
    );
  }
}

export default function vitePluginComponentInsight(options: VitePluginComponentInsightOptions = {}): PluginOption {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const reportJsonPath = resolveOutputPath(resolvedOptions.reportJsonPath || resolvedOptions.reportJsonFile);
  const reportMarkdownPath = resolveOutputPath(
    resolvedOptions.reportMarkdownPath || resolvedOptions.reportMarkdownFile,
  );

  return {
    name: 'vite-plugin-component-insight',
    apply: 'build',
    closeBundle() {
      if (!isMiniProgram()) {
        return;
      }

      const inputDir = process.env.UNI_INPUT_DIR;
      const outputDir = process.env.UNI_OUTPUT_DIR;
      if (!inputDir || !outputDir || !fs.existsSync(outputDir)) {
        return;
      }

      const { pages, subPackageRoots } = readPages(inputDir);
      const pagePathMap = new Map(pages.map((page) => [page.path, page]));
      const jsonFiles = listJsonFiles(outputDir);
      const outputJsonMap = new Map<string, OutputJsonRecord>();

      for (const jsonFile of jsonFiles) {
        const jsonRelativePath = normalizeSlashes(path.relative(outputDir, jsonFile));
        const jsonContent = readJsonFile<{
          component?: boolean;
          usingComponents?: Record<string, string>;
        }>(jsonFile);

        if (!jsonContent) {
          continue;
        }

        outputJsonMap.set(jsonRelativePath, {
          jsonRelativePath,
          logicalPath: stripJsonExtension(jsonRelativePath),
          isComponent: jsonContent.component === true,
          usingComponents: jsonContent.usingComponents ?? {},
        });
      }

      const directUsageGraph = new Map<string, Map<string, number>>();
      for (const record of outputJsonMap.values()) {
        const directUsage = new Map<string, number>();

        for (const componentRef of Object.values(record.usingComponents)) {
          const childJsonRelativePath = resolveUsingComponentPath(record.jsonRelativePath, componentRef, outputDir);
          if (!childJsonRelativePath) {
            continue;
          }
          const childRecord = outputJsonMap.get(childJsonRelativePath);
          if (!childRecord?.isComponent) {
            continue;
          }
          directUsage.set(childRecord.logicalPath, (directUsage.get(childRecord.logicalPath) ?? 0) + 1);
        }

        directUsageGraph.set(record.logicalPath, directUsage);
      }

      const aggregateCache = new Map<string, Map<string, number>>();
      const visiting = new Set<string>();

      const resolveAggregateUsage = (logicalPath: string): Map<string, number> => {
        const cached = aggregateCache.get(logicalPath);
        if (cached) {
          return cached;
        }
        if (visiting.has(logicalPath)) {
          return new Map();
        }

        visiting.add(logicalPath);
        const aggregate = new Map<string, number>();
        const directUsage = directUsageGraph.get(logicalPath) ?? new Map<string, number>();

        for (const [childPath, directCount] of directUsage) {
          aggregate.set(childPath, (aggregate.get(childPath) ?? 0) + directCount);
          const childAggregate = resolveAggregateUsage(childPath);
          for (const [descendantPath, descendantCount] of childAggregate) {
            aggregate.set(descendantPath, (aggregate.get(descendantPath) ?? 0) + directCount * descendantCount);
          }
        }

        visiting.delete(logicalPath);
        aggregateCache.set(logicalPath, aggregate);
        return aggregate;
      };

      const pageUsageMap = new Map<string, Map<string, number>>();
      for (const page of pages) {
        const pageRecord = outputJsonMap.get(`${page.path}.json`);
        if (!pageRecord) {
          continue;
        }
        pageUsageMap.set(page.path, resolveAggregateUsage(pageRecord.logicalPath));
      }

      const componentUsageMap = new Map<string, Map<string, number>>();
      for (const [pagePath, componentUsage] of pageUsageMap) {
        for (const [componentPath, count] of componentUsage) {
          let pageUsage = componentUsageMap.get(componentPath);
          if (!pageUsage) {
            pageUsage = new Map();
            componentUsageMap.set(componentPath, pageUsage);
          }
          pageUsage.set(pagePath, (pageUsage.get(pagePath) ?? 0) + count);
        }
      }

      const componentItems: ComponentInsightItem[] = [];
      for (const [componentPath, pageUsage] of componentUsageMap) {
        const pagesForComponent = Array.from(pageUsage.entries())
          .map(([pagePath, usageCount]) => ({
            page: pagePath,
            packageName: pagePathMap.get(pagePath)?.packageName ?? 'main',
            usageCount,
          }))
          .sort((left, right) => right.usageCount - left.usageCount || left.page.localeCompare(right.page));

        const totalUsageCount = pagesForComponent.reduce((sum, page) => sum + page.usageCount, 0);
        const involvedPackages = Array.from(new Set(pagesForComponent.map((page) => page.packageName)));
        const componentPackage = detectPackageName(componentPath, subPackageRoots);
        const suggestions: string[] = [];

        if (
          resolvedOptions.enableSuggestions &&
          involvedPackages.length === 1 &&
          involvedPackages[0].startsWith('sub:') &&
          componentPackage === 'main'
        ) {
          suggestions.push(`该组件仅在 ${involvedPackages[0]} 使用，建议考虑移动到对应分包。`);
        }

        if (resolvedOptions.enableSuggestions && involvedPackages.includes('main') && involvedPackages.length > 1) {
          suggestions.push('该组件同时被主包和分包使用，建议保留在公共位置。');
        }

        if (resolvedOptions.enableSuggestions && !involvedPackages.includes('main') && involvedPackages.length > 1) {
          suggestions.push('该组件被多个分包共用，建议评估抽到公共目录。');
        }

        if (resolvedOptions.enableSuggestions && pagesForComponent.length === 1 && totalUsageCount <= 2) {
          suggestions.push('该组件仅在单页少量使用，可评估是否需要继续独立维护。');
        }

        if (resolvedOptions.enableSuggestions && componentPackage !== 'main' && involvedPackages.includes('main')) {
          suggestions.push('该组件位于分包目录，但主包也在使用，建议检查目录归属。');
        }

        if (resolvedOptions.enableSuggestions && suggestions.length === 0) {
          suggestions.push('当前没有明显的分包优化建议。');
        }

        componentItems.push({
          component: componentPath,
          componentPackage,
          totalUsageCount,
          pageUsageCount: pagesForComponent.length,
          pages: pagesForComponent,
          suggestions,
        });
      }

      componentItems.sort(
        (left, right) =>
          right.totalUsageCount - left.totalUsageCount ||
          right.pageUsageCount - left.pageUsageCount ||
          left.component.localeCompare(right.component),
      );

      const report: ComponentInsightReport = {
        generatedAt: new Date().toISOString(),
        inputDir,
        outputDir,
        suggestionEnabled: resolvedOptions.enableSuggestions,
        summary: {
          pageCount: pageUsageMap.size,
          componentCount: Array.from(outputJsonMap.values()).filter((item) => item.isComponent).length,
          reportedComponentCount: componentItems.length,
        },
        components: componentItems,
      };

      ensureParentDir(reportJsonPath);
      ensureParentDir(reportMarkdownPath);

      fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
      fs.writeFileSync(reportMarkdownPath, `${buildMarkdown(report)}\n`, 'utf-8');

      if (resolvedOptions.logToConsole) {
        logSummary(report);
      }
    },
  };
}
