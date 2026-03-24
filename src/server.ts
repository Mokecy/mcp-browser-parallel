/**
 * MCP Server — Multi-Instance Parallel Browser
 * 
 * Provides MCP tools for managing multiple isolated browser instances.
 * Each tool takes an instanceId parameter to specify which instance to operate on.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BrowserInstanceManager } from './manager.js';
import { takeSnapshot, getLocator } from './snapshot.js';

export interface ServerConfig {
  cdpEndpoint?: string;
  autoExtractAuth?: boolean;
}

const manager = new BrowserInstanceManager();

export function createServer(config: ServerConfig = {}): Server {
  const server = new Server(
    { name: 'mcp-browser-parallel', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // ───── Tool Definitions ─────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // === Instance Lifecycle ===
      {
        name: 'browser_connect',
        description: 'Connect to an existing Chrome browser via CDP and extract auth cookies. Chrome must be running with --remote-debugging-port. This also extracts cookies/storage so new instances can be created without re-login.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cdpUrl: {
              type: 'string',
              description: 'Chrome CDP URL. Default: http://localhost:9222',
              default: 'http://localhost:9222',
            },
            pageIndex: {
              type: 'number',
              description: 'Index of the page to extract auth from (0-based). Default: 0',
              default: 0,
            },
          },
        },
      },
      {
        name: 'instance_create',
        description: 'Create a new isolated browser instance. Auth (cookies/localStorage) is automatically cloned from the connected Chrome, so no re-login is needed. Each instance has fully isolated state.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: {
              type: 'string',
              description: 'Unique identifier for this instance (e.g. "batch-1", "batch-2")',
            },
            url: {
              type: 'string',
              description: 'URL to navigate to after creation',
            },
            cloneAuth: {
              type: 'boolean',
              description: 'Whether to clone auth from the connected Chrome. Default: true',
              default: true,
            },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'instance_list',
        description: 'List all active browser instances with their current URLs and titles.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'instance_close',
        description: 'Close a specific browser instance and release its resources.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Instance to close' },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'instance_close_all',
        description: 'Close all browser instances.',
        inputSchema: { type: 'object' as const, properties: {} },
      },

      // === Page Operations ===
      {
        name: 'page_navigate',
        description: 'Navigate an instance to a URL.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            url: { type: 'string', description: 'URL to navigate to' },
            waitUntil: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
              description: 'When to consider navigation complete. Default: domcontentloaded',
              default: 'domcontentloaded',
            },
          },
          required: ['instanceId', 'url'],
        },
      },
      {
        name: 'page_snapshot',
        description: 'Take an accessibility snapshot of the page. Returns a structured text representation with refs for interactive elements. Always use this before performing actions to understand the current page state.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_click',
        description: 'Click an element identified by ref from the latest page_snapshot.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref from page_snapshot (e.g. "e5")' },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button. Default: left',
            },
            doubleClick: {
              type: 'boolean',
              description: 'Double click. Default: false',
            },
          },
          required: ['instanceId', 'ref'],
        },
      },
      {
        name: 'page_fill',
        description: 'Clear and fill text into an input element identified by ref.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref from page_snapshot' },
            value: { type: 'string', description: 'Text to fill' },
          },
          required: ['instanceId', 'ref', 'value'],
        },
      },
      {
        name: 'page_type',
        description: 'Type text into a focused element character by character. Useful for triggering input handlers. Use page_fill for fast input.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref to focus and type into' },
            text: { type: 'string', description: 'Text to type' },
            delay: {
              type: 'number',
              description: 'Delay between key presses in ms. Default: 50',
              default: 50,
            },
          },
          required: ['instanceId', 'ref', 'text'],
        },
      },
      {
        name: 'page_select_option',
        description: 'Select option(s) in a <select> element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref of the select element' },
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'Values or labels to select',
            },
          },
          required: ['instanceId', 'ref', 'values'],
        },
      },
      {
        name: 'page_hover',
        description: 'Hover over an element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref to hover over' },
          },
          required: ['instanceId', 'ref'],
        },
      },
      {
        name: 'page_press_key',
        description: 'Press a key or key combination (e.g. "Enter", "Control+a", "Escape").',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            key: { type: 'string', description: 'Key or combination (e.g. "Enter", "Control+a")' },
          },
          required: ['instanceId', 'key'],
        },
      },
      {
        name: 'page_screenshot',
        description: 'Take a screenshot of the page or a specific element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            filePath: { type: 'string', description: 'Absolute path to save screenshot' },
            ref: { type: 'string', description: 'Element ref to screenshot (omit for full page)' },
            fullPage: { type: 'boolean', description: 'Capture full scrollable page. Default: false' },
          },
          required: ['instanceId', 'filePath'],
        },
      },
      {
        name: 'page_wait',
        description: 'Wait for text to appear, disappear, or a specified time.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            text: { type: 'string', description: 'Text to wait for (appears)' },
            textGone: { type: 'string', description: 'Text to wait to disappear' },
            timeout: { type: 'number', description: 'Max wait time in ms. Default: 10000' },
            time: { type: 'number', description: 'Fixed wait time in seconds' },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_evaluate',
        description: 'Evaluate a JavaScript expression in the page context. Returns JSON-serializable result.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            expression: { type: 'string', description: 'JavaScript expression to evaluate' },
          },
          required: ['instanceId', 'expression'],
        },
      },
      {
        name: 'page_maximize',
        description: 'Maximize the browser window for an instance via CDP protocol.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
          },
          required: ['instanceId'],
        },
      },

      // === Missing tools from Playwright MCP ===
      {
        name: 'page_navigate_back',
        description: 'Go back to the previous page in history.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_resize',
        description: 'Resize the browser viewport for an instance.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            width: { type: 'number', description: 'Viewport width in pixels' },
            height: { type: 'number', description: 'Viewport height in pixels' },
          },
          required: ['instanceId', 'width', 'height'],
        },
      },
      {
        name: 'page_drag',
        description: 'Drag an element and drop it onto another element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            startRef: { type: 'string', description: 'Ref of the element to drag' },
            endRef: { type: 'string', description: 'Ref of the element to drop onto' },
          },
          required: ['instanceId', 'startRef', 'endRef'],
        },
      },
      {
        name: 'page_file_upload',
        description: 'Upload one or multiple files via a file input element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Ref of the file input element' },
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Absolute paths of files to upload',
            },
          },
          required: ['instanceId', 'ref', 'paths'],
        },
      },
      {
        name: 'page_fill_form',
        description: 'Fill multiple form fields at once.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ref: { type: 'string', description: 'Element ref' },
                  value: { type: 'string', description: 'Value to fill' },
                },
                required: ['ref', 'value'],
              },
              description: 'Fields to fill',
            },
          },
          required: ['instanceId', 'fields'],
        },
      },
      {
        name: 'page_handle_dialog',
        description: 'Handle a browser dialog (alert, confirm, prompt). Must be called when a dialog is open.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            accept: { type: 'boolean', description: 'Whether to accept (true) or dismiss (false) the dialog' },
            promptText: { type: 'string', description: 'Text to enter for prompt dialogs' },
          },
          required: ['instanceId', 'accept'],
        },
      },
      {
        name: 'page_console_messages',
        description: 'Return all console messages captured from the page.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            level: {
              type: 'string',
              enum: ['error', 'warning', 'info', 'debug'],
              description: 'Filter by level. Each level includes more severe. Default: info',
            },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_network_requests',
        description: 'Return all network requests since the page was loaded.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            includeStatic: {
              type: 'boolean',
              description: 'Include static resources (images, fonts, etc). Default: false',
            },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_run_code',
        description: 'Run a Playwright code snippet against the instance page. For advanced use cases.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            code: { type: 'string', description: 'Async function body receiving (page) parameter. E.g. "async (page) => { return await page.title(); }"' },
          },
          required: ['instanceId', 'code'],
        },
      },
      {
        name: 'page_mouse_click_xy',
        description: 'Click at specific coordinates on the page.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button. Default: left' },
          },
          required: ['instanceId', 'x', 'y'],
        },
      },
      {
        name: 'page_mouse_move_xy',
        description: 'Move the mouse to specific coordinates.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            x: { type: 'number', description: 'X coordinate' },
            y: { type: 'number', description: 'Y coordinate' },
          },
          required: ['instanceId', 'x', 'y'],
        },
      },
      {
        name: 'page_mouse_drag_xy',
        description: 'Drag from one point to another using coordinates.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            startX: { type: 'number', description: 'Start X coordinate' },
            startY: { type: 'number', description: 'Start Y coordinate' },
            endX: { type: 'number', description: 'End X coordinate' },
            endY: { type: 'number', description: 'End Y coordinate' },
          },
          required: ['instanceId', 'startX', 'startY', 'endX', 'endY'],
        },
      },
      {
        name: 'page_pdf_save',
        description: 'Save the page as a PDF file.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            filePath: { type: 'string', description: 'Absolute path to save the PDF' },
          },
          required: ['instanceId', 'filePath'],
        },
      },
      {
        name: 'page_verify_text_visible',
        description: 'Verify that text is visible on the page.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            text: { type: 'string', description: 'Text to verify' },
          },
          required: ['instanceId', 'text'],
        },
      },
      {
        name: 'page_verify_element_visible',
        description: 'Verify that an element with a specific role and name is visible.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            role: { type: 'string', description: 'ARIA role of the element' },
            accessibleName: { type: 'string', description: 'Accessible name of the element' },
          },
          required: ['instanceId', 'role'],
        },
      },
      {
        name: 'page_verify_value',
        description: 'Verify the value of a form element.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref from page_snapshot' },
            value: { type: 'string', description: 'Expected value' },
          },
          required: ['instanceId', 'ref', 'value'],
        },
      },
      {
        name: 'page_generate_locator',
        description: 'Generate a Playwright locator string for the given element, useful for test code generation.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            ref: { type: 'string', description: 'Element ref from page_snapshot' },
          },
          required: ['instanceId', 'ref'],
        },
      },
      {
        name: 'page_start_tracing',
        description: 'Start a Playwright trace recording for debugging.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
          },
          required: ['instanceId'],
        },
      },
      {
        name: 'page_stop_tracing',
        description: 'Stop the trace recording and save to file.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            instanceId: { type: 'string', description: 'Target instance' },
            filePath: { type: 'string', description: 'Path to save the trace file (.zip)' },
          },
          required: ['instanceId', 'filePath'],
        },
      },
    ],
  }));

  // ───── Tool Handlers ─────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // === Instance Lifecycle ===
        case 'browser_connect': {
          const cdpUrl = (args?.cdpUrl as string) || 'http://localhost:9222';
          const pageIndex = (args?.pageIndex as number) ?? 0;

          const connResult = await manager.connect(cdpUrl);
          const authResult = await manager.extractAuth(pageIndex);

          return text(
            `✅ Connected to Chrome at ${cdpUrl}\n` +
            `📄 Pages found: ${connResult.pageCount}\n` +
            `🌐 Current URL: ${connResult.url}\n` +
            `🔐 Auth extracted: ${authResult.cookieCount} cookies, ${authResult.originCount} origins\n\n` +
            `Auth has been saved. New instances created with instance_create will automatically inherit this auth state (no re-login needed).`
          );
        }

        case 'instance_create': {
          const id = args?.instanceId as string;
          const url = args?.url as string | undefined;
          const cloneAuth = (args?.cloneAuth as boolean) ?? true;

          if (!manager.isConnected) {
            return error('Not connected to Chrome. Call browser_connect first.');
          }

          const info = await manager.createInstance(id, url, cloneAuth);
          return text(
            `✅ Instance "${id}" created\n` +
            `🌐 URL: ${info.url}\n` +
            `📄 Title: ${info.title}\n` +
            `🔐 Auth cloned: ${cloneAuth && manager.hasAuth ? 'yes' : 'no'}\n` +
            `⏱️ Created: ${info.createdAt}`
          );
        }

        case 'instance_list': {
          const instances = await manager.listInstances();
          if (instances.length === 0) {
            return text('No active instances. Use instance_create to create one.');
          }
          const lines = instances.map(i => `• ${i.id}: ${i.url} — "${i.title}"`);
          return text(`Active instances (${instances.length}):\n${lines.join('\n')}`);
        }

        case 'instance_close': {
          await manager.closeInstance(args?.instanceId as string);
          return text(`✅ Instance "${args?.instanceId}" closed.`);
        }

        case 'instance_close_all': {
          const count = await manager.closeAll();
          return text(`✅ Closed ${count} instance(s).`);
        }

        // === Page Operations ===
        case 'page_navigate': {
          const instance = manager.getInstance(args?.instanceId as string);
          const url = args?.url as string;
          const waitUntil = (args?.waitUntil as any) || 'domcontentloaded';

          await instance.page.goto(url, { waitUntil, timeout: 30000 });
          return text(`✅ Navigated to: ${instance.page.url()}\nTitle: ${await instance.page.title()}`);
        }

        case 'page_snapshot': {
          const instance = manager.getInstance(args?.instanceId as string);
          const snapshotText = await takeSnapshot(instance);
          return text(
            `Page snapshot for "${instance.id}" (${instance.page.url()}):\n\n${snapshotText}\n\n` +
            `Use [ref=eN] values to interact with elements via page_click, page_fill, etc.`
          );
        }

        case 'page_click': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          const options: any = {};
          if (args?.button) options.button = args.button;
          if (args?.doubleClick) options.clickCount = 2;

          await locator.click(options);
          return text(`✅ Clicked [ref=${args?.ref}]`);
        }

        case 'page_fill': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          await locator.fill(args?.value as string);
          return text(`✅ Filled [ref=${args?.ref}] with "${args?.value}"`);
        }

        case 'page_type': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          await locator.click(); // Focus first
          await instance.page.keyboard.type(args?.text as string, {
            delay: (args?.delay as number) || 50,
          });
          return text(`✅ Typed into [ref=${args?.ref}]: "${args?.text}"`);
        }

        case 'page_select_option': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          await locator.selectOption(args?.values as string[]);
          return text(`✅ Selected option(s) in [ref=${args?.ref}]`);
        }

        case 'page_hover': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          await locator.hover();
          return text(`✅ Hovered over [ref=${args?.ref}]`);
        }

        case 'page_press_key': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.keyboard.press(args?.key as string);
          return text(`✅ Pressed key: ${args?.key}`);
        }

        case 'page_screenshot': {
          const instance = manager.getInstance(args?.instanceId as string);
          const filePath = args?.filePath as string;
          const options: any = { path: filePath };

          if (args?.ref) {
            const locator = getLocator(instance, args.ref as string);
            await locator.screenshot(options);
          } else {
            if (args?.fullPage) options.fullPage = true;
            await instance.page.screenshot(options);
          }

          return text(`✅ Screenshot saved: ${filePath}`);
        }

        case 'page_wait': {
          const instance = manager.getInstance(args?.instanceId as string);
          const timeout = (args?.timeout as number) || 10000;

          if (args?.time) {
            await instance.page.waitForTimeout((args.time as number) * 1000);
            return text(`✅ Waited ${args.time} seconds`);
          }
          if (args?.text) {
            await instance.page.getByText(args.text as string).waitFor({ timeout });
            return text(`✅ Text appeared: "${args.text}"`);
          }
          if (args?.textGone) {
            await instance.page.getByText(args.textGone as string).waitFor({ state: 'hidden', timeout });
            return text(`✅ Text disappeared: "${args.textGone}"`);
          }

          return error('Specify text, textGone, or time.');
        }

        case 'page_evaluate': {
          const instance = manager.getInstance(args?.instanceId as string);
          const result = await instance.page.evaluate(args?.expression as string);
          return text(`Result:\n${JSON.stringify(result, null, 2)}`);
        }

        case 'page_maximize': {
          await manager.maximizeWindow(args?.instanceId as string);
          return text(`✅ Window maximized for instance "${args?.instanceId}"`);
        }

        // === New tools ===
        case 'page_navigate_back': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.goBack({ timeout: 30000 });
          return text(`✅ Navigated back to: ${instance.page.url()}`);
        }

        case 'page_resize': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.setViewportSize({
            width: args?.width as number,
            height: args?.height as number,
          });
          return text(`✅ Viewport resized to ${args?.width}x${args?.height}`);
        }

        case 'page_drag': {
          const instance = manager.getInstance(args?.instanceId as string);
          const source = getLocator(instance, args?.startRef as string);
          const target = getLocator(instance, args?.endRef as string);
          await source.dragTo(target);
          return text(`✅ Dragged [ref=${args?.startRef}] to [ref=${args?.endRef}]`);
        }

        case 'page_file_upload': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          await locator.setInputFiles(args?.paths as string[]);
          return text(`✅ Uploaded ${(args?.paths as string[]).length} file(s) to [ref=${args?.ref}]`);
        }

        case 'page_fill_form': {
          const instance = manager.getInstance(args?.instanceId as string);
          const fields = args?.fields as Array<{ ref: string; value: string }>;
          for (const field of fields) {
            const locator = getLocator(instance, field.ref);
            await locator.fill(field.value);
          }
          return text(`✅ Filled ${fields.length} form field(s)`);
        }

        case 'page_handle_dialog': {
          const instance = manager.getInstance(args?.instanceId as string);
          const accept = args?.accept as boolean;
          const promptText = args?.promptText as string | undefined;
          // Set up dialog handler for the next dialog
          instance.page.once('dialog', async (dialog) => {
            if (accept) {
              await dialog.accept(promptText);
            } else {
              await dialog.dismiss();
            }
          });
          return text(`✅ Dialog handler set: ${accept ? 'accept' : 'dismiss'}${promptText ? ` with text "${promptText}"` : ''}`);
        }

        case 'page_console_messages': {
          const instance = manager.getInstance(args?.instanceId as string);
          const level = (args?.level as string) || 'info';
          const levelOrder = ['error', 'warning', 'info', 'debug'];
          const maxLevel = levelOrder.indexOf(level);
          const typeToLevel: Record<string, number> = {
            'error': 0, 'warning': 1, 'warn': 1,
            'info': 2, 'log': 2, 'debug': 3, 'trace': 3,
          };
          const filtered = instance.consoleMessages.filter(m => {
            const msgLevel = typeToLevel[m.type] ?? 2;
            return msgLevel <= maxLevel;
          });
          if (filtered.length === 0) {
            return text(`No console messages at level "${level}" or above.`);
          }
          const lines = filtered.map(m => `[${m.type}] ${m.text}`);
          return text(`Console messages (${filtered.length}):\n${lines.join('\n')}`);
        }

        case 'page_network_requests': {
          const instance = manager.getInstance(args?.instanceId as string);
          const includeStatic = args?.includeStatic as boolean ?? false;
          const staticTypes = new Set(['image', 'font', 'stylesheet', 'media']);
          let requests = instance.networkRequests;
          if (!includeStatic) {
            requests = requests.filter(r => !staticTypes.has(r.resourceType));
          }
          if (requests.length === 0) {
            return text('No network requests captured.');
          }
          const lines = requests.map(r =>
            `${r.method} ${r.status ?? '...'} ${r.url.substring(0, 120)}`
          );
          return text(`Network requests (${requests.length}):\n${lines.join('\n')}`);
        }

        case 'page_run_code': {
          const instance = manager.getInstance(args?.instanceId as string);
          const code = args?.code as string;
          const fn = new Function('page', `return (${code})(page);`);
          const result = await fn(instance.page);
          return text(`Result:\n${JSON.stringify(result, null, 2)}`);
        }

        case 'page_mouse_click_xy': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.mouse.click(
            args?.x as number,
            args?.y as number,
            { button: (args?.button as any) || 'left' }
          );
          return text(`✅ Clicked at (${args?.x}, ${args?.y})`);
        }

        case 'page_mouse_move_xy': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.mouse.move(args?.x as number, args?.y as number);
          return text(`✅ Mouse moved to (${args?.x}, ${args?.y})`);
        }

        case 'page_mouse_drag_xy': {
          const instance = manager.getInstance(args?.instanceId as string);
          const page = instance.page;
          await page.mouse.move(args?.startX as number, args?.startY as number);
          await page.mouse.down();
          await page.mouse.move(args?.endX as number, args?.endY as number, { steps: 10 });
          await page.mouse.up();
          return text(`✅ Dragged from (${args?.startX},${args?.startY}) to (${args?.endX},${args?.endY})`);
        }

        case 'page_pdf_save': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.page.pdf({ path: args?.filePath as string });
          return text(`✅ PDF saved: ${args?.filePath}`);
        }

        case 'page_verify_text_visible': {
          const instance = manager.getInstance(args?.instanceId as string);
          const textToFind = args?.text as string;
          try {
            await instance.page.getByText(textToFind).first().waitFor({ state: 'visible', timeout: 5000 });
            return text(`✅ Text IS visible: "${textToFind}"`);
          } catch {
            return text(`❌ Text NOT visible: "${textToFind}"`);
          }
        }

        case 'page_verify_element_visible': {
          const instance = manager.getInstance(args?.instanceId as string);
          const role = args?.role as string;
          const name = args?.accessibleName as string | undefined;
          try {
            const locator = name
              ? instance.page.getByRole(role as any, { name })
              : instance.page.getByRole(role as any);
            await locator.first().waitFor({ state: 'visible', timeout: 5000 });
            return text(`✅ Element IS visible: role="${role}"${name ? ` name="${name}"` : ''}`);
          } catch {
            return text(`❌ Element NOT visible: role="${role}"${name ? ` name="${name}"` : ''}`);
          }
        }

        case 'page_verify_value': {
          const instance = manager.getInstance(args?.instanceId as string);
          const locator = getLocator(instance, args?.ref as string);
          const actualValue = await locator.inputValue();
          const expectedValue = args?.value as string;
          if (actualValue === expectedValue) {
            return text(`✅ Value matches: "${expectedValue}"`);
          } else {
            return text(`❌ Value mismatch: expected "${expectedValue}", got "${actualValue}"`);
          }
        }

        case 'page_generate_locator': {
          const instance = manager.getInstance(args?.instanceId as string);
          const info = instance.refMap.get(args?.ref as string);
          if (!info) return error(`Ref "${args?.ref}" not found.`);
          let locatorStr: string;
          if (info.name) {
            locatorStr = `page.getByRole('${info.role}', { name: '${info.name}' })`;
          } else {
            locatorStr = `page.getByRole('${info.role}')`;
          }
          if (info.globalIndex > 0) {
            locatorStr += `.nth(${info.globalIndex})`;
          }
          return text(`Locator for [ref=${args?.ref}]:\n${locatorStr}`);
        }

        case 'page_start_tracing': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.context.tracing.start({ screenshots: true, snapshots: true });
          return text(`✅ Tracing started for "${args?.instanceId}"`);
        }

        case 'page_stop_tracing': {
          const instance = manager.getInstance(args?.instanceId as string);
          await instance.context.tracing.stop({ path: args?.filePath as string });
          return text(`✅ Tracing saved: ${args?.filePath}`);
        }

        default:
          return error(`Unknown tool: ${name}`);
      }
    } catch (err: any) {
      return error(`❌ ${name} failed: ${err.message}`);
    }
  });

  return server;
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
