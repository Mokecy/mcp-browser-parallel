/**
 * MCP Server — Multi-Instance Parallel Browser
 *
 * Provides MCP tools for managing multiple isolated browser instances.
 * Each tool takes an instanceId parameter to specify which instance to operate on.
 *
 * Aligned with the official Playwright MCP implementation:
 * - Uses snapshotForAI() + aria-ref= locator system
 * - waitForCompletion for click/type/fill/hover/select actions
 * - Modal state handling (dialog/fileChooser)
 * - Proper navigate with waitForLoadState
 * - dblclick() for double clicks
 * - locator.fill() / locator.pressSequentially() for type
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export interface ServerConfig {
    cdpEndpoint?: string;
    autoExtractAuth?: boolean;
}
export declare function createServer(config?: ServerConfig): Server;
