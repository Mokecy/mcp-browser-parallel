#!/usr/bin/env node
/**
 * mcp-browser-parallel — Multi-Instance Parallel Browser MCP Server
 *
 * Manages multiple isolated browser contexts within a single Chrome process.
 * Supports auth cloning for zero-login instance creation.
 *
 * Usage:
 *   npx mcp-browser-parallel
 *   npx mcp-browser-parallel --cdp-endpoint http://localhost:9222
 *   npx mcp-browser-parallel --help
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
function parseArgs(args) {
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
        if (arg === '--version' || arg === '-v') {
            console.log('1.0.0');
            process.exit(0);
        }
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith('--')) {
                result[key] = next;
                i++;
            }
            else {
                result[key] = true;
            }
        }
    }
    return result;
}
function printHelp() {
    console.log(`
mcp-browser-parallel — Multi-Instance Parallel Browser MCP Server

Manages multiple isolated browser contexts within a single Chrome process.
Supports automatic auth cloning from a logged-in Chrome browser.

USAGE:
  npx mcp-browser-parallel [options]

OPTIONS:
  --cdp-endpoint <url>     Chrome CDP endpoint to auto-connect on startup.
                           Example: http://localhost:9222
  --auto-extract-auth      Auto-extract auth state when connecting via CDP.
                           Requires --cdp-endpoint. Default: true when
                           cdp-endpoint is set.
  --help, -h               Show this help message.
  --version, -v            Show version.

MCP CLIENT CONFIGURATION:

  Standard (stdio):
    {
      "mcpServers": {
        "browser-parallel": {
          "command": "npx",
          "args": ["mcp-browser-parallel@latest"]
        }
      }
    }

  With auto-connect to Chrome:
    {
      "mcpServers": {
        "browser-parallel": {
          "command": "npx",
          "args": [
            "mcp-browser-parallel@latest",
            "--cdp-endpoint", "http://localhost:9222"
          ]
        }
      }
    }

TOOLS:
  Instance Lifecycle:
    browser_connect        Connect to Chrome CDP + extract auth
    instance_create        Create isolated instance (auto-clones auth)
    instance_list          List all active instances
    instance_close         Close a specific instance
    instance_close_all     Close all instances

  Page Operations (all take instanceId):
    page_navigate          Navigate to URL
    page_snapshot          Accessibility snapshot with refs
    page_click             Click element by ref
    page_fill              Fill text by ref
    page_type              Type text character by character
    page_select_option     Select dropdown option
    page_hover             Hover over element
    page_press_key         Press key or combination
    page_screenshot        Take screenshot
    page_wait              Wait for text/time
    page_evaluate          Evaluate JavaScript
    page_maximize          Maximize window via CDP

WORKFLOW:
  1. Start Chrome with:  chrome --remote-debugging-port=9222
  2. Login to your target system in Chrome
  3. AI calls browser_connect → extracts cookies automatically
  4. AI calls instance_create("batch-1", url=...) → new context, already logged in
  5. AI calls instance_create("batch-2", url=...) → another context, also logged in
  6. All page_* operations are routed by instanceId → no interference
`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const server = createServer({
        cdpEndpoint: args['cdp-endpoint'],
        autoExtractAuth: args['auto-extract-auth'] !== false,
    });
    const transport = new StdioServerTransport();
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await server.close();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        await server.close();
        process.exit(0);
    });
    await server.connect(transport);
    console.error('🚀 mcp-browser-parallel server started (stdio)');
    if (args['cdp-endpoint']) {
        console.error(`CDP endpoint configured: ${args['cdp-endpoint']}`);
        console.error('   Auto-connect will happen on first browser_connect or instance_create call.');
    }
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map