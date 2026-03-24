/**
 * Browser Instance Manager
 * 
 * Manages multiple isolated browser contexts within a single Chrome process.
 * Supports auth cloning via Playwright's storageState.
 * 
 * Aligned with the official Playwright MCP implementation:
 * - waitForCompletion for action stabilization
 * - Native snapshot storage
 * - Modal state tracking (dialog/fileChooser)
 */
import { chromium, Browser, BrowserContext, Page, type Cookie, type Request, Dialog } from 'playwright';

export interface InstanceInfo {
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

export interface StorageStateData {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface ModalState {
  type: 'dialog' | 'fileChooser';
  description: string;
  dialog?: Dialog;
  fileChooser?: any;
}

export class BrowserInstance {
  readonly id: string;
  context: BrowserContext;
  page: Page;
  
  // Legacy ref tracking (fallback for older Playwright)
  private _refMap: Map<string, RefInfo> = new Map();
  private _refCounter: number = 0;
  
  // Native snapshot storage
  lastSnapshot: string = '';
  lastSnapshotDiff: string | undefined;
  
  // Event tracking
  private _consoleMessages: Array<{ type: string; text: string; timestamp: number }> = [];
  private _networkRequests: Array<{ method: string; url: string; status: number | null; resourceType: string; timestamp: number }> = [];
  
  // Modal state tracking (aligned with official Playwright MCP)
  private _modalStates: ModalState[] = [];

  constructor(id: string, context: BrowserContext, page: Page) {
    this.id = id;
    this.context = context;
    this.page = page;
    this._setupListeners();
  }

  private _setupListeners(): void {
    this.page.on('console', (msg) => {
      this._consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });
    this.page.on('request', (req) => {
      this._networkRequests.push({
        method: req.method(),
        url: req.url(),
        status: null,
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      });
    });
    this.page.on('response', (res) => {
      const entry = this._networkRequests.find(r => r.url === res.url() && r.status === null);
      if (entry) entry.status = res.status();
    });
    
    // Dialog tracking (aligned with official Playwright MCP)
    this.page.on('dialog', (dialog) => {
      this._modalStates.push({
        type: 'dialog',
        description: `"${dialog.type()}" dialog with message "${dialog.message()}"`,
        dialog,
      });
    });
    
    // File chooser tracking
    this.page.on('filechooser', (chooser) => {
      this._modalStates.push({
        type: 'fileChooser',
        description: 'File chooser',
        fileChooser: chooser,
      });
    });
  }

  get consoleMessages() { return this._consoleMessages; }
  get networkRequests() { return this._networkRequests; }
  get modalStates() { return this._modalStates; }

  get refMap(): Map<string, RefInfo> { return this._refMap; }
  get refCounter(): number { return this._refCounter; }
  set refCounter(val: number) { this._refCounter = val; }

  clearRefs(): void {
    this._refMap.clear();
    this._refCounter = 0;
  }
  
  clearModalState(state: ModalState): void {
    this._modalStates = this._modalStates.filter(s => s !== state);
  }
  
  hasModalState(): boolean {
    return this._modalStates.length > 0;
  }
  
  /**
   * Wait for completion after an action (aligned with official Playwright MCP).
   * Monitors network requests triggered by the action and waits for them to settle.
   */
  async waitForCompletion(callback: () => Promise<void>): Promise<void> {
    const requests: Request[] = [];
    const requestListener = (request: Request) => requests.push(request);
    
    this.page.on('request', requestListener);
    
    try {
      await callback();
      // Brief wait to collect triggered requests (same as official: 500ms)
      await this._waitForTimeout(500);
    } finally {
      this.page.off('request', requestListener);
    }
    
    // Check if a navigation was triggered
    const requestedNavigation = requests.some(request => request.isNavigationRequest());
    if (requestedNavigation) {
      await this.page.mainFrame().waitForLoadState('load', { timeout: 10000 }).catch(() => {});
      return;
    }
    
    // Wait for important resource requests to complete
    const promises: Promise<any>[] = [];
    for (const request of requests) {
      const resourceType = request.resourceType();
      if (['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(resourceType)) {
        promises.push(
          request.response()
            .then(r => r?.finished())
            .catch(() => {})
        );
      } else {
        promises.push(request.response().catch(() => {}));
      }
    }
    
    // Race: wait for all requests or timeout after 5 seconds
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.race([Promise.all(promises), timeout]);
    
    // If there were requests, wait a bit more for rendering
    if (requests.length) {
      await this._waitForTimeout(500);
    }
  }
  
  /**
   * Safe timeout that works even when dialog is blocking JS execution
   */
  private async _waitForTimeout(ms: number): Promise<void> {
    if (this._modalStates.some(s => s.type === 'dialog')) {
      // Dialog blocks page JS, use Node timeout instead
      await new Promise(f => setTimeout(f, ms));
      return;
    }
    // Use page.evaluate for more accurate timing
    await this.page.evaluate(() => new Promise(f => setTimeout(f, 500))).catch(() => {});
  }
}

export interface RefInfo {
  role: string;
  name: string;
  globalIndex: number;
}

export class BrowserInstanceManager {
  private browser: Browser | null = null;
  private instances: Map<string, BrowserInstance> = new Map();
  private savedStorageState: StorageStateData | null = null;
  private cdpUrl: string = '';

  /**
   * Connect to an existing Chrome instance via CDP.
   */
  async connect(cdpUrl: string = 'http://localhost:9222'): Promise<{ pageCount: number; url: string }> {
    if (this.browser) {
      await this.disconnectBrowser();
    }

    this.cdpUrl = cdpUrl;
    this.browser = await chromium.connectOverCDP(cdpUrl);
    
    const contexts = this.browser.contexts();
    const pages = contexts.flatMap(c => c.pages());
    
    const firstPage = pages[0];
    const url = firstPage ? firstPage.url() : 'about:blank';

    return { pageCount: pages.length, url };
  }

  /**
   * Extract authentication state from existing Chrome page.
   */
  async extractAuth(pageIndex: number = 0): Promise<{ cookieCount: number; originCount: number }> {
    if (!this.browser) throw new Error('Not connected. Call browser_connect first.');

    const contexts = this.browser.contexts();
    const pages = contexts.flatMap(c => c.pages());
    
    if (pages.length === 0) {
      throw new Error('No pages found in browser. Open a page and login first.');
    }
    if (pageIndex >= pages.length) {
      throw new Error(`Page index ${pageIndex} out of range. Only ${pages.length} pages available.`);
    }

    const page = pages[pageIndex];
    this.savedStorageState = await page.context().storageState() as StorageStateData;
    
    return {
      cookieCount: this.savedStorageState.cookies.length,
      originCount: this.savedStorageState.origins.length,
    };
  }

  /**
   * Create a new isolated browser instance with optional auth cloning.
   */
  async createInstance(id: string, url?: string, cloneAuth: boolean = true): Promise<InstanceInfo> {
    if (!this.browser) throw new Error('Not connected. Call browser_connect first.');
    if (this.instances.has(id)) throw new Error(`Instance "${id}" already exists.`);

    const contextOptions: any = {};
    if (cloneAuth && this.savedStorageState) {
      contextOptions.storageState = this.savedStorageState;
    }

    contextOptions.viewport = null; // Use full window size
    
    const context = await this.browser.newContext(contextOptions);
    const page = await context.newPage();

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Aligned with official: also wait for load state
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    }

    const instance = new BrowserInstance(id, context, page);
    this.instances.set(id, instance);

    return {
      id,
      url: page.url(),
      title: await page.title(),
      createdAt: new Date().toISOString(),
    };
  }

  getInstance(id: string): BrowserInstance {
    const instance = this.instances.get(id);
    if (!instance) {
      const available = Array.from(this.instances.keys()).join(', ') || '(none)';
      throw new Error(`Instance "${id}" not found. Available: ${available}`);
    }
    return instance;
  }

  async listInstances(): Promise<InstanceInfo[]> {
    const result: InstanceInfo[] = [];
    for (const [id, instance] of this.instances) {
      result.push({
        id,
        url: instance.page.url(),
        title: await instance.page.title(),
        createdAt: '',
      });
    }
    return result;
  }

  async closeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance "${id}" not found.`);
    
    await instance.context.close();
    this.instances.delete(id);
  }

  async closeAll(): Promise<number> {
    const count = this.instances.size;
    for (const [id, instance] of this.instances) {
      await instance.context.close();
    }
    this.instances.clear();
    return count;
  }

  async maximizeWindow(instanceId: string): Promise<void> {
    const instance = this.getInstance(instanceId);
    const page = instance.page;
    
    const client = await page.context().newCDPSession(page);
    const { windowId } = await client.send('Browser.getWindowForTarget');
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    });
    await page.waitForTimeout(300);
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
  }

  get hasAuth(): boolean {
    return this.savedStorageState !== null;
  }

  get isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  private async disconnectBrowser(): Promise<void> {
    if (this.browser) {
      await this.closeAll();
      this.browser = null;
    }
  }

  async dispose(): Promise<void> {
    await this.disconnectBrowser();
  }
}