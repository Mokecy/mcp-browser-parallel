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
import { chromium } from 'playwright';
export class BrowserInstance {
    id;
    context;
    page;
    // Legacy ref tracking (fallback for older Playwright)
    _refMap = new Map();
    _refCounter = 0;
    // Native snapshot storage
    lastSnapshot = '';
    lastSnapshotDiff;
    // Event tracking
    _consoleMessages = [];
    _networkRequests = [];
    // Modal state tracking (aligned with official Playwright MCP)
    _modalStates = [];
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
    get refMap() { return this._refMap; }
    get refCounter() { return this._refCounter; }
    set refCounter(val) { this._refCounter = val; }
    clearRefs() {
        this._refMap.clear();
        this._refCounter = 0;
    }
    clearModalState(state) {
        this._modalStates = this._modalStates.filter(s => s !== state);
    }
    hasModalState() {
        return this._modalStates.length > 0;
    }
    /**
     * Wait for completion after an action (aligned with official Playwright MCP).
     * Monitors network requests triggered by the action and waits for them to settle.
     */
    async waitForCompletion(callback) {
        const requests = [];
        const requestListener = (request) => requests.push(request);
        this.page.on('request', requestListener);
        try {
            await callback();
            // Brief wait to collect triggered requests (same as official: 500ms)
            await this._waitForTimeout(500);
        }
        finally {
            this.page.off('request', requestListener);
        }
        // Check if a navigation was triggered
        const requestedNavigation = requests.some(request => request.isNavigationRequest());
        if (requestedNavigation) {
            await this.page.mainFrame().waitForLoadState('load', { timeout: 10000 }).catch(() => { });
            return;
        }
        // Wait for important resource requests to complete
        const promises = [];
        for (const request of requests) {
            const resourceType = request.resourceType();
            if (['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(resourceType)) {
                promises.push(request.response()
                    .then(r => r?.finished())
                    .catch(() => { }));
            }
            else {
                promises.push(request.response().catch(() => { }));
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
    async _waitForTimeout(ms) {
        if (this._modalStates.some(s => s.type === 'dialog')) {
            // Dialog blocks page JS, use Node timeout instead
            await new Promise(f => setTimeout(f, ms));
            return;
        }
        // Use page.evaluate for more accurate timing
        await this.page.evaluate(() => new Promise(f => setTimeout(f, 500))).catch(() => { });
    }
}
export class BrowserInstanceManager {
    browser = null;
    instances = new Map();
    savedStorageState = null;
    cdpUrl = '';
    /**
     * Connect to an existing Chrome instance via CDP.
     */
    async connect(cdpUrl = 'http://localhost:9222') {
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
     */
    async createInstance(id, url, cloneAuth = true) {
        if (!this.browser)
            throw new Error('Not connected. Call browser_connect first.');
        if (this.instances.has(id))
            throw new Error(`Instance "${id}" already exists.`);
        const contextOptions = {};
        if (cloneAuth && this.savedStorageState) {
            contextOptions.storageState = this.savedStorageState;
        }
        contextOptions.viewport = null; // Use full window size
        const context = await this.browser.newContext(contextOptions);
        const page = await context.newPage();
        if (url) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            // Aligned with official: also wait for load state
            await page.waitForLoadState('load', { timeout: 5000 }).catch(() => { });
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
    getInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            const available = Array.from(this.instances.keys()).join(', ') || '(none)';
            throw new Error(`Instance "${id}" not found. Available: ${available}`);
        }
        return instance;
    }
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
    async closeInstance(id) {
        const instance = this.instances.get(id);
        if (!instance)
            throw new Error(`Instance "${id}" not found.`);
        await instance.context.close();
        this.instances.delete(id);
    }
    async closeAll() {
        const count = this.instances.size;
        for (const [id, instance] of this.instances) {
            await instance.context.close();
        }
        this.instances.clear();
        return count;
    }
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
    get hasAuth() {
        return this.savedStorageState !== null;
    }
    get isConnected() {
        return this.browser !== null && this.browser.isConnected();
    }
    async disconnectBrowser() {
        if (this.browser) {
            await this.closeAll();
            this.browser = null;
        }
    }
    async dispose() {
        await this.disconnectBrowser();
    }
}
//# sourceMappingURL=manager.js.map