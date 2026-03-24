/**
 * Browser Instance Manager
 *
 * Manages multiple isolated browser contexts within a single Chrome process.
 * Supports auth cloning via Playwright's storageState.
 */
import { chromium } from 'playwright';
export class BrowserInstance {
    id;
    context;
    page;
    _refMap = new Map();
    _refCounter = 0;
    _consoleMessages = [];
    _networkRequests = [];
    constructor(id, context, page) {
        this.id = id;
        this.context = context;
        this.page = page;
        this._setupListeners();
    }
    _setupListeners() {
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
            if (entry)
                entry.status = res.status();
        });
    }
    get consoleMessages() { return this._consoleMessages; }
    get networkRequests() { return this._networkRequests; }
    get refMap() { return this._refMap; }
    get refCounter() { return this._refCounter; }
    set refCounter(val) { this._refCounter = val; }
    clearRefs() {
        this._refMap.clear();
        this._refCounter = 0;
    }
}
export class BrowserInstanceManager {
    browser = null;
    instances = new Map();
    savedStorageState = null;
    cdpUrl = '';
    /**
     * Connect to an existing Chrome instance via CDP.
     * Chrome must be running with --remote-debugging-port.
     */
    async connect(cdpUrl = 'http://localhost:9222') {
        if (this.browser) {
            // Already connected, disconnect first
            await this.disconnectBrowser();
        }
        this.cdpUrl = cdpUrl;
        this.browser = await chromium.connectOverCDP(cdpUrl);
        // Get existing pages
        const contexts = this.browser.contexts();
        const pages = contexts.flatMap(c => c.pages());
        const firstPage = pages[0];
        const url = firstPage ? firstPage.url() : 'about:blank';
        return { pageCount: pages.length, url };
    }
    /**
     * Extract authentication state (cookies + localStorage) from existing Chrome page.
     * This enables cloning auth to new isolated instances without re-login.
     */
    async extractAuth(pageIndex = 0) {
        if (!this.browser)
            throw new Error('Not connected. Call browser_connect first.');
        const contexts = this.browser.contexts();
        const pages = contexts.flatMap(c => c.pages());
        if (pages.length === 0) {
            throw new Error('No pages found in browser. Open a page and login first.');
        }
        if (pageIndex >= pages.length) {
            throw new Error(`Page index ${pageIndex} out of range. Only ${pages.length} pages available.`);
        }
        const page = pages[pageIndex];
        this.savedStorageState = await page.context().storageState();
        return {
            cookieCount: this.savedStorageState.cookies.length,
            originCount: this.savedStorageState.origins.length,
        };
    }
    /**
     * Create a new isolated browser instance with optional auth cloning.
     * Each instance has its own BrowserContext (cookies, storage, cache are isolated).
     */
    async createInstance(id, url, cloneAuth = true) {
        if (!this.browser)
            throw new Error('Not connected. Call browser_connect first.');
        if (this.instances.has(id))
            throw new Error(`Instance "${id}" already exists.`);
        // Create context with or without cloned auth
        const contextOptions = {};
        if (cloneAuth && this.savedStorageState) {
            contextOptions.storageState = this.savedStorageState;
        }
        // Maximize viewport
        contextOptions.viewport = null; // Use full window size
        const context = await this.browser.newContext(contextOptions);
        const page = await context.newPage();
        // Navigate to URL if provided
        if (url) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    /**
     * Get an instance by ID.
     */
    getInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            const available = Array.from(this.instances.keys()).join(', ') || '(none)';
            throw new Error(`Instance "${id}" not found. Available: ${available}`);
        }
        return instance;
    }
    /**
     * List all active instances.
     */
    async listInstances() {
        const result = [];
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
    /**
     * Close a specific instance.
     */
    async closeInstance(id) {
        const instance = this.instances.get(id);
        if (!instance)
            throw new Error(`Instance "${id}" not found.`);
        await instance.context.close();
        this.instances.delete(id);
    }
    /**
     * Close all instances.
     */
    async closeAll() {
        const count = this.instances.size;
        for (const [id, instance] of this.instances) {
            await instance.context.close();
        }
        this.instances.clear();
        return count;
    }
    /**
     * Maximize window via CDP protocol.
     */
    async maximizeWindow(instanceId) {
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
    /**
     * Check if manager has auth state saved.
     */
    get hasAuth() {
        return this.savedStorageState !== null;
    }
    /**
     * Check if connected to a browser.
     */
    get isConnected() {
        return this.browser !== null && this.browser.isConnected();
    }
    /**
     * Disconnect from browser (does not close Chrome).
     */
    async disconnectBrowser() {
        if (this.browser) {
            await this.closeAll();
            this.browser = null;
        }
    }
    /**
     * Clean up all resources.
     */
    async dispose() {
        await this.disconnectBrowser();
    }
}
//# sourceMappingURL=manager.js.map