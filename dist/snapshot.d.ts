/**
 * Page Snapshot Utilities
 *
 * Takes accessibility snapshots of pages and provides ref-based element targeting.
 * Uses Playwright's accessibility tree for structure and getByRole for element location.
 */
import { Locator } from 'playwright';
import { BrowserInstance } from './manager.js';
/**
 * Take an accessibility snapshot of the page, assign refs to interactive nodes,
 * and return a formatted text representation.
 */
export declare function takeSnapshot(instance: BrowserInstance): Promise<string>;
/**
 * Get a Playwright Locator for a ref from the snapshot.
 */
export declare function getLocator(instance: BrowserInstance, ref: string): Locator;
