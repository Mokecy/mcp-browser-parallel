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
import { BrowserContext, Page, type Cookie, Dialog } from 'playwright';
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
export interface ModalState {
    type: 'dialog' | 'fileChooser';
    description: string;
    dialog?: Dialog;
    fileChooser?: any;
}
export declare class BrowserInstance {
    readonly id: string;
    context: BrowserContext;
    page: Page;
    private _refMap;
    private _refCounter;
    lastSnapshot: string;
    lastSnapshotDiff: string | undefined;
    private _consoleMessages;
    private _networkRequests;
    private _modalStates;
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
    get modalStates(): ModalState[];
    get refMap(): Map<string, RefInfo>;
    get refCounter(): number;
    set refCounter(val: number);
    clearRefs(): void;
    clearModalState(state: ModalState): void;
    hasModalState(): boolean;
    /**
     * Wait for completion after an action (aligned with official Playwright MCP).
     * Monitors network requests triggered by the action and waits for them to settle.
     */
    waitForCompletion(callback: () => Promise<void>): Promise<void>;
    /**
     * Safe timeout that works even when dialog is blocking JS execution
     */
    private _waitForTimeout;
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
     */
    connect(cdpUrl?: string): Promise<{
        pageCount: number;
        url: string;
    }>;
    /**
     * Extract authentication state from existing Chrome page.
     */
    extractAuth(pageIndex?: number): Promise<{
        cookieCount: number;
        originCount: number;
    }>;
    /**
     * Create a new isolated browser instance with optional auth cloning.
     */
    createInstance(id: string, url?: string, cloneAuth?: boolean): Promise<InstanceInfo>;
    getInstance(id: string): BrowserInstance;
    listInstances(): Promise<InstanceInfo[]>;
    closeInstance(id: string): Promise<void>;
    closeAll(): Promise<number>;
    maximizeWindow(instanceId: string): Promise<void>;
    get hasAuth(): boolean;
    get isConnected(): boolean;
    private disconnectBrowser;
    dispose(): Promise<void>;
}
