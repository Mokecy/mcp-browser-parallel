/**
 * MCP Server — Multi-Instance Parallel Browser
 *
 * Provides MCP tools for managing multiple isolated browser instances.
 * Each tool takes an instanceId parameter to specify which instance to operate on.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export interface ServerConfig {
    cdpEndpoint?: string;
    autoExtractAuth?: boolean;
}
export declare function createServer(config?: ServerConfig): Server;
