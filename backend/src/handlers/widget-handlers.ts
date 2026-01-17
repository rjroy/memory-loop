/**
 * Widget Handlers
 *
 * Handles widget operations for vault dashboards and file views:
 * - get_ground_widgets: Dashboard widgets computed from vault data
 * - get_recall_widgets: File-specific widgets based on frontmatter
 * - widget_edit: Update frontmatter fields and recompute widgets
 */

import type { HandlerContext, WebSocketLike } from "./types.js";
import { requireVault, isFileBrowserError } from "./types.js";
import { wsLog as log } from "../logger.js";
import matter from "gray-matter";

/**
 * Handles get_ground_widgets message.
 * Returns computed ground widgets for the vault dashboard.
 */
export async function handleGetGroundWidgets(ctx: HandlerContext): Promise<void> {
  log.info("Getting ground widgets");

  if (!requireVault(ctx)) {
    log.warn("No vault selected for ground widgets");
    return;
  }

  if (!ctx.state.widgetEngine) {
    log.warn("Widget engine not initialized");
    ctx.send({
      type: "ground_widgets",
      widgets: [],
    });
    return;
  }

  try {
    const loadedWidgets = ctx.state.widgetEngine.getWidgets();
    log.info(`Widget engine has ${loadedWidgets.length} widget(s) loaded`);
    for (const w of loadedWidgets) {
      log.info(`  - ${w.id}: location=${w.config.location}, type=${w.config.type}, pattern=${w.config.source.pattern}`);
    }

    const widgets = await ctx.state.widgetEngine.computeGroundWidgets();
    log.info(`Computed ${widgets.length} ground widget(s)`);

    for (const w of widgets) {
      if (w.isEmpty) {
        log.info(`  - ${w.widgetId}: EMPTY (${w.emptyReason})`);
      } else {
        log.info(`  - ${w.widgetId}: data=${JSON.stringify(w.data).slice(0, 100)}...`);
      }
    }

    ctx.send({
      type: "ground_widgets",
      widgets,
    });
  } catch (error) {
    log.error("Failed to compute ground widgets", error);
    ctx.send({
      type: "widget_error",
      error: error instanceof Error ? error.message : "Failed to compute ground widgets",
    });
  }
}

/**
 * Handles get_recall_widgets message.
 * Returns computed recall widgets for a specific file.
 */
export async function handleGetRecallWidgets(
  ctx: HandlerContext,
  filePath: string
): Promise<void> {
  log.info(`Getting recall widgets for: ${filePath}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for recall widgets");
    return;
  }

  if (!ctx.state.widgetEngine) {
    log.warn("Widget engine not initialized");
    ctx.send({
      type: "recall_widgets",
      path: filePath,
      widgets: [],
    });
    return;
  }

  try {
    const widgets = await ctx.state.widgetEngine.computeRecallWidgets(filePath);
    log.info(`Computed ${widgets.length} recall widget(s) for ${filePath}`);

    ctx.send({
      type: "recall_widgets",
      path: filePath,
      widgets,
    });
  } catch (error) {
    log.error(`Failed to compute recall widgets for ${filePath}`, error);
    ctx.send({
      type: "widget_error",
      filePath,
      error: error instanceof Error ? error.message : "Failed to compute recall widgets",
    });
  }
}

/**
 * Sets a nested value in an object using dot-notation path.
 * Creates intermediate objects as needed.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * Handles widget_edit message.
 * Updates a frontmatter field and triggers widget recomputation.
 */
export async function handleWidgetEdit(
  ctx: HandlerContext,
  filePath: string,
  fieldPath: string,
  value: unknown
): Promise<void> {
  log.info(`Widget edit: ${filePath} -> ${fieldPath} = ${JSON.stringify(value)}`);

  if (!requireVault(ctx)) {
    log.warn("No vault selected for widget edit");
    return;
  }

  try {
    const { content } = await ctx.deps.readMarkdownFile(
      ctx.state.currentVault.contentRoot,
      filePath
    );

    const parsed = ctx.deps.parseFrontmatter(content);
    const frontmatter = parsed.data;

    setNestedValue(frontmatter, fieldPath, value);

    const newContent = matter.stringify(parsed.content, frontmatter);

    await ctx.deps.writeMarkdownFile(
      ctx.state.currentVault.contentRoot,
      filePath,
      newContent
    );

    log.info(`Widget edit successful: ${filePath}`);

    if (ctx.state.widgetEngine) {
      ctx.state.widgetEngine.handleFilesChanged([filePath]);

      const recallWidgets = await ctx.state.widgetEngine.computeRecallWidgets(filePath);
      if (recallWidgets.length > 0) {
        ctx.send({
          type: "widget_update",
          widgets: recallWidgets,
        });
      }

      const groundWidgets = await ctx.state.widgetEngine.computeGroundWidgets();
      if (groundWidgets.length > 0) {
        ctx.send({
          type: "widget_update",
          widgets: groundWidgets,
        });
      }
    }
  } catch (error) {
    log.error(`Widget edit failed: ${filePath}`, error);

    if (isFileBrowserError(error)) {
      ctx.sendError(error.code, error.message);
    } else {
      ctx.send({
        type: "widget_error",
        filePath,
        error: error instanceof Error ? error.message : "Failed to edit widget field",
      });
    }
  }
}

/**
 * Handles file change events from the widget file watcher.
 * Invalidates cache and sends widget_update to client.
 */
export function handleWidgetFileChanges(
  ctx: HandlerContext,
  ws: WebSocketLike,
  changedPaths: string[]
): void {
  if (!ctx.state.widgetEngine || changedPaths.length === 0) {
    return;
  }

  log.info(`Widget file changes detected: ${changedPaths.length} file(s)`);

  const { invalidatedWidgets, totalEntriesInvalidated } =
    ctx.state.widgetEngine.handleFilesChanged(changedPaths);

  if (invalidatedWidgets.length === 0) {
    log.debug("No widgets affected by file changes");
    return;
  }

  log.info(
    `Invalidated ${totalEntriesInvalidated} cache entries for ${invalidatedWidgets.length} widget(s)`
  );

  void recomputeAndSendWidgets(ctx, ws, invalidatedWidgets);
}

/**
 * Recomputes widgets and sends widget_update message.
 * Called after file changes invalidate cached widget data.
 */
async function recomputeAndSendWidgets(
  ctx: HandlerContext,
  ws: WebSocketLike,
  invalidatedWidgetIds: string[]
): Promise<void> {
  if (!ctx.state.widgetEngine || ws.readyState !== 1) {
    return;
  }

  try {
    const widgets = ctx.state.widgetEngine.getWidgets();
    const affectedGroundWidgets = widgets.filter(
      (w) => w.config.location === "ground" && invalidatedWidgetIds.includes(w.id)
    );

    if (affectedGroundWidgets.length > 0) {
      const groundResults = await ctx.state.widgetEngine.computeGroundWidgets();
      if (groundResults.length > 0 && ws.readyState === 1) {
        ctx.send({
          type: "widget_update",
          widgets: groundResults,
        });
        log.info(`Sent widget_update with ${groundResults.length} ground widget(s)`);
      }
    }
  } catch (error) {
    log.error("Failed to recompute widgets after file change", error);
  }
}
