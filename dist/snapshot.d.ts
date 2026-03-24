/**
 * Page Snapshot Utilities
 *
 * Takes accessibility snapshots of pages using Playwright's native snapshotForAI() API
 * and provides ref-based element targeting via the built-in aria-ref= locator system.
 *
 * Aligned with the official Playwright MCP implementation.
 */
import { Locator } from 'playwright';
import { BrowserInstance } from './manager.js';
/**
 * Take an accessibility snapshot of the page using Playwright's native snapshotForAI().
 * Returns the structured YAML-like aria snapshot text with [ref=eN] markers.
 */
export declare function takeSnapshot(instance: BrowserInstance): Promise<string>;
/**
 * Get a Playwright Locator for a ref from the snapshot.
 * Uses the native aria-ref= locator system built into Playwright.
 */
export declare function getLocator(instance: BrowserInstance, ref: string): Locator;
