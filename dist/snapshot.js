/**
 * Take an accessibility snapshot of the page using Playwright's native snapshotForAI().
 * Returns the structured YAML-like aria snapshot text with [ref=eN] markers.
 */
export async function takeSnapshot(instance) {
    const page = instance.page;
    try {
        // Use Playwright's native snapshotForAI() which returns aria snapshot with refs
        const snapshot = await page.snapshotForAI({ track: 'response' });
        // Store the full snapshot for reference
        instance.lastSnapshot = snapshot.full || snapshot;
        instance.lastSnapshotDiff = snapshot.incremental;
        return typeof snapshot === 'string' ? snapshot : (snapshot.full || JSON.stringify(snapshot));
    }
    catch (e) {
        // Fallback: try the older accessibility.snapshot() API
        console.error(`snapshotForAI not available, falling back to accessibility.snapshot(): ${e.message}`);
        return await takeSnapshotLegacy(instance);
    }
}
/**
 * Get a Playwright Locator for a ref from the snapshot.
 * Uses the native aria-ref= locator system built into Playwright.
 */
export function getLocator(instance, ref) {
    const page = instance.page;
    try {
        // Use Playwright's native aria-ref= locator (the same as official MCP)
        return page.locator(`aria-ref=${ref}`);
    }
    catch (e) {
        // Fallback to legacy ref map
        return getLocatorLegacy(instance, ref);
    }
}
const INTERACTIVE_ROLES = new Set([
    'link', 'button', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
    'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'treeitem', 'option', 'listbox',
    'cell', 'columnheader', 'rowheader', 'row',
]);
async function takeSnapshotLegacy(instance) {
    instance.clearRefs();
    // @ts-ignore
    const snapshot = await instance.page.accessibility.snapshot();
    if (!snapshot) {
        return '(empty page - no accessible content)';
    }
    const globalCounts = new Map();
    const lines = [];
    processNode(snapshot, 0, instance, globalCounts, lines);
    return lines.join('\n');
}
function processNode(node, depth, instance, globalCounts, lines) {
    const indent = '  '.repeat(depth);
    const interactive = INTERACTIVE_ROLES.has(node.role);
    let refStr = '';
    if (interactive) {
        const ref = `e${instance.refCounter}`;
        instance.refCounter = instance.refCounter + 1;
        const key = `${node.role}||${node.name || ''}`;
        const idx = globalCounts.get(key) || 0;
        globalCounts.set(key, idx + 1);
        instance.refMap.set(ref, {
            role: node.role,
            name: node.name || '',
            globalIndex: idx,
        });
        refStr = ` [ref=${ref}]`;
    }
    let line = `${indent}- ${node.role}`;
    if (node.name)
        line += ` "${truncate(node.name, 80)}"`;
    const attrs = [];
    if (node.value !== undefined)
        attrs.push(`value="${truncate(node.value, 50)}"`);
    if (node.level !== undefined)
        attrs.push(`level=${node.level}`);
    if (node.checked !== undefined)
        attrs.push(`checked=${node.checked}`);
    if (node.disabled)
        attrs.push('disabled');
    if (node.expanded !== undefined)
        attrs.push(`expanded=${node.expanded}`);
    if (node.selected !== undefined)
        attrs.push(`selected=${node.selected}`);
    if (node.pressed !== undefined)
        attrs.push(`pressed=${node.pressed}`);
    if (node.description)
        attrs.push(`desc="${truncate(node.description, 50)}"`);
    if (attrs.length > 0)
        line += ` (${attrs.join(', ')})`;
    line += refStr;
    lines.push(line);
    if (node.children) {
        for (const child of node.children) {
            processNode(child, depth + 1, instance, globalCounts, lines);
        }
    }
}
function getLocatorLegacy(instance, ref) {
    const info = instance.refMap.get(ref);
    if (!info) {
        const available = Array.from(instance.refMap.keys()).slice(0, 10).join(', ');
        throw new Error(`Ref "${ref}" not found. Available refs: ${available}... ` +
            `Take a new page_snapshot to get current refs.`);
    }
    const page = instance.page;
    let locator;
    if (info.name) {
        locator = page.getByRole(info.role, { name: info.name });
    }
    else {
        locator = page.getByRole(info.role);
    }
    if (info.globalIndex > 0) {
        locator = locator.nth(info.globalIndex);
    }
    return locator;
}
function truncate(str, maxLen) {
    if (str.length <= maxLen)
        return str;
    return str.substring(0, maxLen - 3) + '...';
}
//# sourceMappingURL=snapshot.js.map