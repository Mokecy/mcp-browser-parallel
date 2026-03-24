/**
 * Browser Instance Manager
 *
 * Manages multiple isolated browser contexts within a single Chrome process.
 * Supports auth cloning via Playwright's storageState.
 */
import { BrowserContext, Page, type Cookie } from 'playwright';
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
        localStorage: Array<{
            name: string;
            value: string;
        }>;
    }>;
}
export declare class BrowserInstance {
    readonly id: string;
    context: BrowserContext;
    page: Page;
    private _refMap;
    private _refCounter;
    private _consoleMessages;
    private _networkRequests;
    constructor(id: string, context: BrowserContext, page: Page);
    private _setupListeners;
    get consoleMessages(): {
        type: string;
        text: string;
        timestamp: number;
    }[];
    get networkRequests(): {
        method: string;
        url: string;
        status: number | null;
        resourceType: string;
        timestamp: number;
    }[];
    get refMap(): Map<string, RefInfo>;
    get refCounter(): number;
    set refCounter(val: number);
    clearRefs(): void;
}
export interface RefInfo {
    role: string;
    name: string;
    globalIndex: number;
}
export declare class BrowserInstanceManager {
    private browser;
    private instances;
    private savedStorageState;
    private cdpUrl;
    /**
     * Connect to an existing Chrome instance via CDP.
     * Chrome must be running with --remote-debugging-port.
     */
    connect(cdpUrl?: string): Promise<{
        pageCount: number;
        url: string;
    }>;
    /**
     * Extract authentication state (cookies + localStorage) from existing Chrome page.
     * This enables cloning auth to new isolated instances without re-login.
     */
    extractAuth(pageIndex?: number): Promise<{
        cookieCount: number;
        originCount: number;
    }>;
    /**
     * Create a new isolated browser instance with optional auth cloning.
     * Each instance has its own BrowserContext (cookies, storage, cache are isolated).
     */
    createInstance(id: string, url?: string, cloneAuth?: boolean): Promise<InstanceInfo>;
    /**
     * Get an instance by ID.
     */
    getInstance(id: string): BrowserInstance;
    /**
     * List all active instances.
     */
    listInstances(): Promise<InstanceInfo[]>;
    /**
     * Close a specific instance.
     */
    closeInstance(id: string): Promise<void>;
    /**
     * Close all instances.
     */
    closeAll(): Promise<number>;
    /**
     * Maximize window via CDP protocol.
     */
    maximizeWindow(instanceId: string): Promise<void>;
    /**
     * Check if manager has auth state saved.
     */
    get hasAuth(): boolean;
    /**
     * Check if connected to a browser.
     */
    get isConnected(): boolean;
    /**
     * Disconnect from browser (does not close Chrome).
     */
    private disconnectBrowser;
    /**
     * Clean up all resources.
     */
    dispose(): Promise<void>;
}
