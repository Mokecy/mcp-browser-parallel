/**
 * Take an accessibility snapshot of the page, assign refs to interactive nodes,
 * and return a formatted text representation.
 */
export async function takeSnapshot(instance) {
    // Clear previous refs
    instance.clearRefs();
    // @ts-ignore - accessibility API exists at runtime but types may vary across versions
    const snapshot = await instance.page.accessibility.snapshot();
    if (!snapshot) {
        return '(empty page - no accessible content)';
    }
    // Track role+name counts for disambiguation
    const globalCounts = new Map();
    const lines = [];
    processNode(snapshot, 0, instance, globalCounts, lines);
    return lines.join('\n');
}
const INTERACTIVE_ROLES = new Set([
    'link', 'button', 'textbox', 'searchbox', 'combobox',
    'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
    'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'treeitem', 'option', 'listbox',
    'cell', 'columnheader', 'rowheader', 'row',
]);
function isInteractive(role) {
    return INTERACTIVE_ROLES.has(role);
}
function processNode(node, depth, instance, globalCounts, lines) {
    const indent = '  '.repeat(depth);
    const interactive = isInteractive(node.role);
    // Assign ref to interactive elements
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
    // Build line
    let line = `${indent}- ${node.role}`;
    if (node.name)
        line += ` "${truncate(node.name, 80)}"`;
    // Attributes
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
    // Process children
    if (node.children) {
        for (const child of node.children) {
            processNode(child, depth + 1, instance, globalCounts, lines);
        }
    }
}
/**
 * Get a Playwright Locator for a ref from the snapshot.
 */
export function getLocator(instance, ref) {
    const info = instance.refMap.get(ref);
    if (!info) {
        const available = Array.from(instance.refMap.keys()).slice(0, 10).join(', ');
        throw new Error(`Ref "${ref}" not found. Available refs: ${available}... ` +
            `Take a new page_snapshot to get current refs.`);
    }
    const page = instance.page;
    let locator;
    // Build locator from role and name
    if (info.name) {
        locator = page.getByRole(info.role, { name: info.name });
    }
    else {
        locator = page.getByRole(info.role);
    }
    // Use nth() to disambiguate if there are multiple matches
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