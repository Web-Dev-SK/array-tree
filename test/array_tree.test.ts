import {describe, expect, it, vi} from 'vitest';
import {ArrayTree} from '../src/array_tree.js';
import type {IArrayTreeOptions} from '../src/types.js';

// ───────────────────────── helpers ─────────────────────────

interface N {
  name: string;
  children?: N[];
  collapsed?: boolean;
  filtered?: boolean;
}

type Flags = Pick<N, 'collapsed' | 'filtered'>;

const n = (name: string, children?: N[], flags: Flags = {}): N =>
  ({name, ...(children ? {children} : {}), ...flags});

/** Прямой доступ к служебным полям (имена по умолчанию). */
const raw = (x: N) => x as unknown as Record<string, unknown>;

/**
 * root
 *  ├ A
 *  │  ├ A1
 *  │  └ A2
 *  ├ B (collapsed)
 *  │  ├ B1
 *  │  └ B2
 *  └ C
 */
const sample = (): N => n('root', [
  n('A', [n('A1'), n('A2')]),
  n('B', [n('B1'), n('B2')], {collapsed: true}),
  n('C'),
]);

function all(root: N): N[] {
  const out: N[] = [];
  const walk = (x: N) => {
    out.push(x);
    (x.children ?? []).forEach(walk);
  };
  walk(root);
  return out;
}

const find = (root: N, name: string): N => all(root).find(x => x.name === name)!;

/**
 * Ожидаемый плоский список, посчитанный независимо от класса.
 * Виртуальный корень (includeRoot=false) игнорирует свой флаг collapsed.
 */
function expectedFlat(root: N, includeRoot: boolean): [string, number][] {
  const out: [string, number][] = [];
  const walk = (parent: N, depth: number, virtualRoot = false) => {
    if (parent.filtered || (!virtualRoot && parent.collapsed) || !parent.children) return;
    for (const c of parent.children) {
      if (c.filtered) continue;
      out.push([c.name, depth]);
      walk(c, depth + 1);
    }
  };
  if (includeRoot) {
    out.push([root.name, 0]);
    walk(root, 1);
  }
  else {
    walk(root, 0, true);
  }
  return out;
}

/** Полная проверка согласованности массива и дерева. */
function check(at: ArrayTree<N>, includeRoot: boolean) {
  const root = at.getTree();
  const arr = at.getArray();
  expect(arr.map(i => [i.node.name, i.depth])).toEqual(expectedFlat(root, includeRoot));

  const inArray = new Set<N>();
  arr.forEach((item, i) => {
    expect(inArray.has(item.node)).toBe(false);
    inArray.add(item.node);
    expect(at.getIndex(item.node)).toBe(i);
    expect(item.id).toBe(at.getNodeId(item.node));
  });

  const ids = new Set<number>();
  for (const node of all(root)) {
    const id = at.getNodeId(node);
    expect(id).not.toBeUndefined();
    expect(ids.has(id!)).toBe(false);
    ids.add(id!);
    if (!inArray.has(node)) {
      expect(at.getIndex(node)).toBeUndefined();
    }
    for (const c of node.children ?? []) {
      expect(at.getParent(c)).toBe(node);
    }
  }
  expect(at.getParent(root)).toBeNull();
}

/** Удалённые узлы (и всё их поддерево) не должны хранить служебные поля. */
function checkDetached(at: ArrayTree<N>, detachedTops: N[]) {
  for (const top of detachedTops) {
    for (const x of all(top)) {
      expect(at.getNodeId(x)).toBeUndefined();
      expect(at.getParent(x)).toBeUndefined();
      expect(at.getIndex(x)).toBeUndefined();
    }
  }
}

const flat = (at: ArrayTree<N>) => at.getArray().map(i => `${i.node.name}:${i.depth}`);

/** includeRoot задаётся явно (по умолчанию false), чтобы тесты не зависели от умолчания класса. */
function make(opts: IArrayTreeOptions = {}, root: N = sample()) {
  const includeRoot = opts.includeRoot ?? false;
  const at = new ArrayTree<N>(root, {...opts, includeRoot});
  return {
    at,
    root,
    includeRoot,
    get: (name: string) => find(root, name),
    ok: () => check(at, includeRoot),
  };
}

// ───────────────────────── constructor ─────────────────────────

describe('constructor', () => {
  it('includes the root by default', () => {
    const at = new ArrayTree<N>(sample());
    expect(flat(at)[0]).toBe('root:0');
    check(at, true);
  });

  it('excludes the root with includeRoot: false', () => {
    const {at, ok} = make();
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'B:0', 'C:0']);
    ok();
  });

  it('puts the root first with includeRoot', () => {
    const {at, ok} = make({includeRoot: true});
    expect(flat(at)).toEqual(['root:0', 'A:1', 'A1:2', 'A2:2', 'B:1', 'C:1']);
    ok();
  });

  it('mutates the given tree in place (no copy)', () => {
    const root = sample();
    const at = new ArrayTree<N>(root);
    expect(at.getTree()).toBe(root);
  });

  it('assigns unique ids and parents', () => {
    const {at, root, get} = make();
    expect(at.getParent(root)).toBeNull();
    expect(at.getParent(get('A'))).toBe(root);
    expect(at.getParent(get('A1'))).toBe(get('A'));
    expect(new Set(all(root).map(x => at.getNodeId(x))).size).toBe(all(root).length);
  });

  it('keeps ids that already exist', () => {
    const root = sample();
    raw(find(root, 'A'))._x_id = 777;
    const at = new ArrayTree<N>(root);
    expect(at.getNodeId(find(root, 'A'))).toBe(777);
  });

  it('treats id 0 as an existing id', () => {
    const root = sample();
    raw(find(root, 'A'))._x_id = 0;
    const at = new ArrayTree<N>(root, {includeRoot: false});
    expect(at.getNodeId(find(root, 'A'))).toBe(0);
    check(at, false);
  });

  it('nested nodes get their children into the array (regression)', () => {
    const {at, get} = make();
    expect(at.getArray().map(i => i.node)).toEqual([get('A'), get('A1'), get('A2'), get('B'), get('C')]);
  });

  it('skips filtered nodes together with their subtree', () => {
    const root = n('root', [
      n('a', [n('a1')], {filtered: true}),
      n('b', [n('b1')]),
    ]);
    const {at, ok} = make({}, root);
    expect(flat(at)).toEqual(['b:0', 'b1:1']);
    ok();
  });

  it('does not show children of collapsed nodes, nested collapsed stay collapsed', () => {
    const root = n('root', [
      n('a', [n('a1', [n('a11')], {collapsed: true})]),
    ]);
    const {at, ok} = make({}, root);
    expect(flat(at)).toEqual(['a:0', 'a1:1']);
    ok();
  });

  it('item node is the child, not the parent (regression)', () => {
    const {at, get} = make();
    const arr = at.getArray();
    expect(arr[0].node).toBe(get('A'));
    expect(arr[1].node).toBe(get('A1'));
    expect(arr[0].id).not.toBe(arr[1].id);
  });

  it('ignores the collapsed flag of a virtual root', () => {
    const root = sample();
    root.collapsed = true;
    const {at, ok} = make({}, root);
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'B:0', 'C:0']);
    ok();
  });

  it('a collapsed root with includeRoot shows only the root', () => {
    const root = sample();
    root.collapsed = true;
    const {at, ok} = make({includeRoot: true}, root);
    expect(flat(at)).toEqual(['root:0']);
    ok();
  });

  it('supports custom field names', () => {
    interface D { title: string; kids?: D[]; closed?: boolean; hidden?: boolean }
    const root: D = {
      title: 'r',
      kids: [
        {title: 'a', kids: [{title: 'a1'}], closed: true},
        {title: 'b', hidden: true},
        {title: 'c'},
      ],
    };
    const at = new ArrayTree<D>(root, {
      includeRoot: false,
      childrenFieldName: 'kids',
      collapsedFieldName: 'closed',
      filteredFieldName: 'hidden',
      parentFieldName: 'up',
      indexNodeFieldName: 'ix',
      idFieldName: 'uid',
      arrayIdFieldName: 'key',
    });
    expect(at.getArray().map(i => i.node.title)).toEqual(['a', 'c']);
    const a = root.kids![0] as any;
    const item = at.getArray()[0];
    expect(item.id).toBe(at.getNodeId(a));
    expect(item.id).toBe(a.uid);
    expect(a.up).toBe(root);
    expect(a.ix).toBe(0);
    expect('_x_parent' in a).toBe(false);

    expect(at.expandNode(a)).toEqual([{index: 1, removed: 0, inserted: 1}]);
    expect(at.getArray().map(i => i.node.title)).toEqual(['a', 'a1', 'c']);
    at.insertNode({title: 'new'}, root);
    expect(at.getArray().map(i => i.node.title)).toEqual(['a', 'a1', 'c', 'new']);

    at.deleteNode(a);
    expect(a.up).toBeUndefined();
    expect(a.uid).toBeUndefined();
    expect(at.getArray().map(i => i.node.title)).toEqual(['c', 'new']);
  });
});

describe('getArray', () => {
  it('is a live reference, replaced by setNewTree', () => {
    const {at, get} = make();
    const arr = at.getArray();
    at.collapseNode(get('A'));
    expect(at.getArray()).toBe(arr);
    at.setNewTree(at.getTree());
    expect(at.getArray()).not.toBe(arr);
  });
});

describe('getParent', () => {
  it('null for the root, undefined for a deleted node', () => {
    const {at, root, get} = make();
    const c = get('C');
    expect(at.getParent(root)).toBeNull();
    expect(at.getParent(c)).toBe(root);
    at.deleteNode(c);
    expect(at.getParent(c)).toBeUndefined();
  });
});

// ───────────────────────── collapse / expand ─────────────────────────

describe('collapseNode', () => {
  it('removes visible descendants and reports the change', () => {
    const {at, get, ok} = make();
    expect(at.collapseNode(get('A'))).toEqual([{index: 1, removed: 2, inserted: 0}]);
    expect(flat(at)).toEqual(['A:0', 'B:0', 'C:0']);
    expect(at.isCollapsed(get('A'))).toBe(true);
    expect(at.getIndex(get('A1'))).toBeUndefined();
    ok();
  });

  it('returns [] for an already collapsed node', () => {
    const {at, get} = make();
    expect(at.collapseNode(get('B'))).toEqual([]);
  });

  it('returns [] for a leaf but still sets the flag', () => {
    const {at, get, ok} = make();
    expect(at.collapseNode(get('C'))).toEqual([]);
    expect(at.isCollapsed(get('C'))).toBe(true);
    ok();
  });

  it('only sets the flag for a hidden node', () => {
    const {at, get, ok} = make();
    expect(at.collapseNode(get('B1'))).toEqual([]);
    expect(at.isCollapsed(get('B1'))).toBe(true);
    ok();
  });

  it('cannot collapse the root without includeRoot', () => {
    const {at, root, ok} = make();
    expect(at.collapseNode(root)).toEqual([]);
    expect(root.collapsed).toBeFalsy();
    ok();
  });

  it('collapses the root with includeRoot', () => {
    const {at, root, ok} = make({includeRoot: true});
    expect(at.collapseNode(root)).toEqual([{index: 1, removed: 5, inserted: 0}]);
    expect(flat(at)).toEqual(['root:0']);
    ok();
  });

  it('cannot collapse a deleted node', () => {
    const {at, get} = make();
    const c = get('C');
    at.deleteNode(c);
    expect(at.collapseNode(c)).toEqual([]);
    expect(c.collapsed).toBeFalsy();
  });
});

describe('expandNode', () => {
  it('inserts children after the node (regression: condition must not be inverted)', () => {
    const {at, get, ok} = make();
    expect(at.expandNode(get('B'))).toEqual([{index: 4, removed: 0, inserted: 2}]);
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'B:0', 'B1:1', 'B2:1', 'C:0']);
    expect(at.isCollapsed(get('B'))).toBe(false);
    ok();
  });

  it('returns [] when the node is not collapsed', () => {
    const {at, get} = make();
    expect(at.expandNode(get('A'))).toEqual([]);
  });

  it('keeps nested collapsed nodes collapsed', () => {
    const root = n('root', [
      n('a', [n('a1', [n('a11')], {collapsed: true}), n('a2')], {collapsed: true}),
    ]);
    const {at, get, ok} = make({}, root);
    expect(at.expandNode(get('a'))).toEqual([{index: 1, removed: 0, inserted: 2}]);
    expect(flat(at)).toEqual(['a:0', 'a1:1', 'a2:1']);
    ok();
  });

  it('clears the flag of a collapsed leaf and returns []', () => {
    const root = n('root', [n('a', undefined, {collapsed: true})]);
    const {at, get} = make({}, root);
    expect(at.expandNode(get('a'))).toEqual([]);
    expect(at.isCollapsed(get('a'))).toBe(false);
  });

  it('only clears the flag of a hidden node', () => {
    const root = n('root', [
      n('a', [n('a1', [n('a11')], {collapsed: true})], {collapsed: true}),
    ]);
    const {at, get, ok} = make({}, root);
    expect(at.expandNode(get('a1'))).toEqual([]);
    expect(at.isCollapsed(get('a1'))).toBe(false);
    ok();
  });

  it('collapse + expand round trip restores the array', () => {
    const {at, get, ok} = make();
    const before = flat(at);
    at.collapseNode(get('A'));
    at.expandNode(get('A'));
    expect(flat(at)).toEqual(before);
    ok();
  });

  it('expands the root with includeRoot', () => {
    const {at, root, ok} = make({includeRoot: true});
    at.collapseNode(root);
    expect(at.expandNode(root)).toEqual([{index: 1, removed: 0, inserted: 5}]);
    expect(flat(at)).toEqual(['root:0', 'A:1', 'A1:2', 'A2:2', 'B:1', 'C:1']);
    ok();
  });

  it('cannot expand the root without includeRoot', () => {
    const {at, root} = make();
    root.collapsed = true;
    expect(at.expandNode(root)).toEqual([]);
  });
});

describe('expandNodeAndParents', () => {
  it('expands every collapsed ancestor', () => {
    const root = n('root', [
      n('a', [n('a1', [n('a11')], {collapsed: true})], {collapsed: true}),
    ]);
    const {at, get, ok} = make({}, root);
    const changes = at.expandNodeAndParents(get('a11'));
    expect(changes).toEqual([
      {index: 1, removed: 0, inserted: 1},
      {index: 2, removed: 0, inserted: 1},
    ]);
    expect(flat(at)).toEqual(['a:0', 'a1:1', 'a11:2']);
    ok();
  });

  it('returns [] when nothing is collapsed', () => {
    const {at, get} = make();
    expect(at.expandNodeAndParents(get('A1'))).toEqual([]);
  });

  it('expands a collapsed root with includeRoot', () => {
    const {at, root, get, ok} = make({includeRoot: true});
    at.collapseNode(root);
    at.expandNodeAndParents(get('A1'));
    expect(flat(at)).toEqual(['root:0', 'A:1', 'A1:2', 'A2:2', 'B:1', 'C:1']);
    ok();
  });
});

// ───────────────────────── insertNode ─────────────────────────

describe('insertNode', () => {
  it('appends to the root', () => {
    const {at, root, ok} = make();
    const x = n('X');
    expect(at.insertNode(x, root)).toEqual([{index: 5, removed: 0, inserted: 1}]);
    expect(flat(at).slice(-1)).toEqual(['X:0']);
    expect(at.getParent(x)).toBe(root);
    expect(at.getNodeId(x)).not.toBeUndefined();
    ok();
  });

  it('inserts at the start of the root', () => {
    const {at, root, ok} = make();
    expect(at.insertNode(n('X'), root, 0)).toEqual([{index: 0, removed: 0, inserted: 1}]);
    expect(flat(at)[0]).toBe('X:0');
    ok();
  });

  it('inserts between siblings', () => {
    const {at, root, ok} = make();
    expect(at.insertNode(n('X'), root, 1)).toEqual([{index: 3, removed: 0, inserted: 1}]);
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'X:0', 'B:0', 'C:0']);
    ok();
  });

  it('appends to a nested node after its subtree', () => {
    const {at, get, ok} = make();
    at.insertNode(n('X'), get('A'));
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'X:1', 'B:0', 'C:0']);
    ok();
  });

  it('inserts into the middle of a nested node', () => {
    const {at, get, ok} = make();
    at.insertNode(n('X'), get('A'), 1);
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'X:1', 'A2:1', 'B:0', 'C:0']);
    ok();
  });

  it('creates the children array for a leaf', () => {
    const {at, get, ok} = make();
    const x = n('X');
    at.insertNode(x, get('C'));
    expect(get('C').children).toEqual([x]);
    expect(flat(at).slice(-2)).toEqual(['C:0', 'X:1']);
    ok();
  });

  it('inserts a whole subtree', () => {
    const {at, root, ok} = make();
    const x = n('X', [n('Y'), n('Z')]);
    expect(at.insertNode(x, root)).toEqual([{index: 5, removed: 0, inserted: 3}]);
    expect(flat(at).slice(-3)).toEqual(['X:0', 'Y:1', 'Z:1']);
    ok();
  });

  it('inserts a collapsed subtree as a single row', () => {
    const {at, root, get, ok} = make();
    const x = n('X', [n('Y')], {collapsed: true});
    expect(at.insertNode(x, root)).toEqual([{index: 5, removed: 0, inserted: 1}]);
    expect(at.getIndex(get('Y'))).toBeUndefined();
    ok();
  });

  it('into a collapsed target: tree only, no array change', () => {
    const {at, get, ok} = make();
    const x = n('X');
    expect(at.insertNode(x, get('B'))).toEqual([]);
    expect(get('B').children).toHaveLength(3);
    expect(at.getIndex(x)).toBeUndefined();
    ok();
    at.expandNode(get('B'));
    expect(flat(at)).toContain('X:1');
    ok();
  });

  it('into a filtered target: tree only', () => {
    const root = n('root', [n('f', [n('f1')], {filtered: true})]);
    const {at, get, ok} = make({}, root);
    expect(at.insertNode(n('X'), get('f'))).toEqual([]);
    expect(flat(at)).toEqual([]);
    ok();
  });

  it('a filtered node is added to the tree but not to the array', () => {
    const {at, root, ok} = make();
    const x = n('X', undefined, {filtered: true});
    expect(at.insertNode(x, root)).toEqual([]);
    expect(root.children).toContain(x);
    ok();
  });

  it('inserting before a filtered sibling lands before the next visible one', () => {
    const root = n('root', [n('a'), n('b', undefined, {filtered: true}), n('c')]);
    const {at, ok} = make({}, root);
    at.insertNode(n('X'), root, 1);
    expect(root.children!.map(c => c.name)).toEqual(['a', 'X', 'b', 'c']);
    expect(flat(at)).toEqual(['a:0', 'X:0', 'c:0']);
    ok();
  });

  it('inserting when all following siblings are filtered goes to the end of the target', () => {
    const root = n('root', [n('a'), n('b'), n('c', undefined, {filtered: true})]);
    const {at, ok} = make({}, root);
    at.insertNode(n('X'), root, 2);
    expect(root.children!.map(c => c.name)).toEqual(['a', 'b', 'X', 'c']);
    expect(flat(at)).toEqual(['a:0', 'b:0', 'X:0']);
    ok();
  });

  it('out-of-range index appends', () => {
    const {at, root, ok} = make();
    at.insertNode(n('X'), root, 99);
    at.insertNode(n('Y'), root, -5);
    expect(root.children!.slice(-2).map(c => c.name)).toEqual(['X', 'Y']);
    ok();
  });

  it('into a virtual root works even if its collapsed flag is set', () => {
    const root = sample();
    root.collapsed = true;
    const {at, ok} = make({}, root);
    expect(at.insertNode(n('X'), root)).toEqual([{index: 5, removed: 0, inserted: 1}]);
    expect(flat(at).slice(-1)).toEqual(['X:0']);
    ok();
  });

  it('throws for a node that is already in the tree and changes nothing', () => {
    const {at, root, get, ok} = make();
    const before = flat(at);
    expect(() => at.insertNode(get('C'), root)).toThrow();
    expect(flat(at)).toEqual(before);
    expect(root.children).toHaveLength(3);
    ok();
  });

  it('throws when a descendant already has an id', () => {
    const {at, root} = make();
    const y = n('Y');
    raw(y)._x_id = 5;
    expect(() => at.insertNode(n('X', [y]), root)).toThrow();
  });

  it('throws for a node with id 0', () => {
    const {at, root} = make();
    const x = n('X');
    raw(x)._x_id = 0;
    expect(() => at.insertNode(x, root)).toThrow();
  });

  it('a deleted node can be inserted again and gets new ids', () => {
    const {at, root, get, ok} = make();
    const a = get('A');
    const oldIds = all(a).map(x => at.getNodeId(x));
    at.deleteNode(a);
    at.insertNode(a, root);
    const newIds = all(a).map(x => at.getNodeId(x));
    expect(newIds.every(id => id !== undefined)).toBe(true);
    expect(newIds.some(id => oldIds.includes(id))).toBe(false);
    ok();
  });

  it('with includeRoot: the root is a normal visible target', () => {
    const {at, root, ok} = make({includeRoot: true});
    expect(at.insertNode(n('X'), root)).toEqual([{index: 6, removed: 0, inserted: 1}]);
    expect(flat(at).slice(-1)).toEqual(['X:1']);
    at.insertNode(n('Y'), root, 0);
    expect(flat(at)[1]).toBe('Y:1');
    ok();
  });

  it('with includeRoot and a collapsed root: tree only', () => {
    const {at, root, ok} = make({includeRoot: true});
    at.collapseNode(root);
    expect(at.insertNode(n('X'), root)).toEqual([]);
    expect(flat(at)).toEqual(['root:0']);
    ok();
  });
});

// ───────────────────────── deleteNode ─────────────────────────

describe('deleteNode', () => {
  it('removes a node with its visible subtree', () => {
    const {at, root, get, ok} = make();
    const a = get('A');
    const a1 = get('A1');
    expect(at.deleteNode(a)).toEqual([{index: 0, removed: 3, inserted: 0}]);
    expect(flat(at)).toEqual(['B:0', 'C:0']);
    expect(root.children).not.toContain(a);
    expect(at.getIndex(a)).toBeUndefined();
    expect(at.getIndex(a1)).toBeUndefined();
    ok();
  });

  it('removes the last leaf', () => {
    const {at, get, ok} = make();
    expect(at.deleteNode(get('C'))).toEqual([{index: 4, removed: 1, inserted: 0}]);
    ok();
  });

  it('removes a collapsed node with hidden children as one row', () => {
    const {at, get, ok} = make();
    expect(at.deleteNode(get('B'))).toEqual([{index: 3, removed: 1, inserted: 0}]);
    ok();
  });

  it('removes a hidden node from the tree only', () => {
    const {at, get, ok} = make();
    const b = get('B');
    expect(at.deleteNode(get('B1'))).toEqual([]);
    expect(b.children!.map(c => c.name)).toEqual(['B2']);
    ok();
  });

  it('cannot delete the root', () => {
    const {at, root, ok} = make();
    const rootId = at.getNodeId(root);
    expect(at.deleteNode(root)).toEqual([]);
    expect(root.children).toHaveLength(3);
    expect(at.getNodeId(root)).toBe(rootId);
    ok();
  });

  it('cannot delete the root with includeRoot', () => {
    const {at, root, ok} = make({includeRoot: true});
    expect(at.deleteNode(root)).toEqual([]);
    ok();
  });

  it('deleting a detached node is a no-op', () => {
    const {at, get} = make();
    const c = get('C');
    at.deleteNode(c);
    expect(at.deleteNode(c)).toEqual([]);
  });

  it('shifts indexes with includeRoot', () => {
    const {at, get, ok} = make({includeRoot: true});
    expect(at.deleteNode(get('A'))).toEqual([{index: 1, removed: 3, inserted: 0}]);
    ok();
  });

  it('dontReindex leaves stale indexes until reindexFromNode', () => {
    const {at, get, ok} = make();
    at.deleteNode(get('A1'), true);
    expect(at.getIndex(get('A2'))).toBeUndefined();   // устаревший индекс не принимается
    at.reindexFromNode(get('A'));
    expect(at.getIndex(get('A2'))).toBe(1);
    ok();
  });

  it('clears id, parent and index of the whole subtree, including hidden nodes', () => {
    const {at, get} = make();
    const a = get('A');
    const b = get('B');                       // свёрнут: B1 и B2 скрыты
    at.deleteNode(a);
    at.deleteNode(b);
    for (const x of [...all(a), ...all(b)]) {
      expect(raw(x)._x_id).toBeUndefined();
      expect(raw(x)._x_parent).toBeUndefined();
      expect(raw(x)._x_array_ind).toBeUndefined();
    }
  });

  it('keeps user data of the deleted subtree', () => {
    const {at, get} = make();
    const b = get('B');
    at.deleteNode(b);
    expect(b.collapsed).toBe(true);
    expect(b.children!.map(c => c.name)).toEqual(['B1', 'B2']);
  });

  it('a deleted node can be inserted back and restores the same rows', () => {
    const {at, root, get, ok} = make();
    const before = flat(at);
    const a = get('A');
    at.deleteNode(a);
    at.insertNode(a, root, 0);
    expect(flat(at)).toEqual(before);
    ok();
  });
});

// ───────────────────────── move ─────────────────────────

describe('canMoveNode', () => {
  it('rules', () => {
    const {at, root, get} = make();
    expect(at.canMoveNode(root, get('A'))).toBe(false);       // у корня нет родителя
    expect(at.canMoveNode(get('A'), get('B'))).toBe(true);
    expect(at.canMoveNode(get('A'), get('A1'))).toBe(false);  // в своего потомка
    expect(at.canMoveNode(get('A'), get('A'))).toBe(false);   // в себя
    expect(at.canMoveNode(get('A1'), get('A'))).toBe(true);   // в своего родителя
  });

  it('a deleted node cannot be moved', () => {
    const {at, get} = make();
    const c = get('C');
    at.deleteNode(c);
    expect(at.canMoveNode(c, get('A'))).toBe(false);
  });
});

describe('isNodeParentOf / getTopNonRootNode / isNodeContainer', () => {
  it('isNodeParentOf(ancestor, node)', () => {
    const {at, root, get} = make();
    expect(at.isNodeParentOf(get('A'), get('A1'))).toBe(true);
    expect(at.isNodeParentOf(get('A'), get('A'))).toBe(true);
    expect(at.isNodeParentOf(root, get('A1'))).toBe(true);
    expect(at.isNodeParentOf(get('A1'), get('A'))).toBe(false);
  });

  it('getTopNonRootNode', () => {
    const {at, root, get} = make();
    expect(at.getTopNonRootNode(get('A1'))).toBe(get('A'));
    expect(at.getTopNonRootNode(get('A'))).toBe(get('A'));
    expect(at.getTopNonRootNode(root)).toBe(root);
  });

  it('isNodeContainer', () => {
    const {at, root, get} = make();
    expect(at.isNodeContainer(root)).toBe(true);
    expect(at.isNodeContainer(get('A'))).toBe(true);
    expect(at.isNodeContainer(get('C'))).toBe(false);
    at.insertNode(n('X'), get('C'));
    expect(at.isNodeContainer(get('C'))).toBe(true);
  });
});

describe('moveNodeToIndex', () => {
  it('moves a leaf into another leaf', () => {
    const {at, get, ok} = make();
    const changes = at.moveNodeToIndex(get('A1'), get('C'), 0);
    expect(changes).toEqual([
      {index: 1, removed: 1, inserted: 0},
      {index: 4, removed: 0, inserted: 1},
    ]);
    expect(flat(at)).toEqual(['A:0', 'A2:1', 'B:0', 'C:0', 'A1:1']);
    ok();
  });

  it('moves a subtree to the end of the root', () => {
    const {at, root, get, ok} = make();
    expect(at.moveNodeToIndex(get('A'), root, 2)).toEqual([
      {index: 0, removed: 3, inserted: 0},
      {index: 2, removed: 0, inserted: 3},
    ]);
    expect(flat(at)).toEqual(['B:0', 'C:0', 'A:0', 'A1:1', 'A2:1']);
    ok();
  });

  it('moves within the same parent (index is applied after removal)', () => {
    const {at, root, get, ok} = make();
    at.moveNodeToIndex(get('A'), root, 1);
    expect(root.children!.map(c => c.name)).toEqual(['B', 'A', 'C']);
    expect(flat(at)).toEqual(['B:0', 'A:0', 'A1:1', 'A2:1', 'C:0']);
    ok();
  });

  it('keeps ids and parents of the moved subtree', () => {
    const {at, root, get, ok} = make();
    const a = get('A');
    const ids = all(a).map(x => at.getNodeId(x));
    at.moveNodeToIndex(a, root, 2);
    expect(all(a).map(x => at.getNodeId(x))).toEqual(ids);
    expect(at.getParent(a)).toBe(root);
    expect(at.getParent(get('A1'))).toBe(a);
    ok();
  });

  it('returns null when moving into a descendant, tree untouched', () => {
    const {at, get, ok} = make();
    expect(at.moveNodeToIndex(get('A'), get('A1'), 0)).toBeNull();
    ok();
  });

  it('returns null for the root', () => {
    const {at, root, get, ok} = make();
    expect(at.moveNodeToIndex(root, get('A'), 0)).toBeNull();
    ok();
  });

  it('into a collapsed target: only a removal in the array', () => {
    const {at, get, ok} = make();
    const a1 = get('A1');
    expect(at.moveNodeToIndex(a1, get('B'), 0)).toEqual([{index: 1, removed: 1, inserted: 0}]);
    expect(get('B').children![0]).toBe(a1);
    expect(at.getIndex(a1)).toBeUndefined();
    ok();
  });

  it('a hidden node moved to a visible place: only an insertion', () => {
    const {at, root, get, ok} = make();
    expect(at.moveNodeToIndex(get('B1'), root, 0)).toEqual([{index: 0, removed: 0, inserted: 1}]);
    expect(flat(at)[0]).toBe('B1:0');
    ok();
  });

  it('works with includeRoot', () => {
    const {at, root, get, ok} = make({includeRoot: true});
    at.moveNodeToIndex(get('A'), root, 2);
    expect(flat(at)).toEqual(['root:0', 'B:1', 'C:1', 'A:1', 'A1:2', 'A2:2']);
    ok();
  });
});

describe('moveNodeRelative', () => {
  it('before', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('C'), get('A'), 'before');
    expect(flat(at)).toEqual(['C:0', 'A:0', 'A1:1', 'A2:1', 'B:0']);
    ok();
  });

  it('after', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('C'), get('A'), 'after');
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'C:0', 'B:0']);
    ok();
  });

  it('after the last child of a nested parent', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('A1'), get('A2'), 'after');
    expect(flat(at)).toEqual(['A:0', 'A2:1', 'A1:1', 'B:0', 'C:0']);
    ok();
  });

  it('inside appends to the end', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('C'), get('A'), 'inside');
    expect(flat(at)).toEqual(['A:0', 'A1:1', 'A2:1', 'C:1', 'B:0']);
    ok();
  });

  it('inside a leaf', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('A1'), get('A2'), 'inside');
    expect(flat(at)).toEqual(['A:0', 'A2:1', 'A1:2', 'B:0', 'C:0']);
    ok();
  });

  it('inside the root', () => {
    const {at, get, ok} = make();
    at.moveNodeRelative(get('A1'), at.getTree(), 'inside');
    expect(flat(at).slice(-1)).toEqual(['A1:0']);
    ok();
  });

  it('node === reference returns null', () => {
    const {at, get} = make();
    expect(at.moveNodeRelative(get('A'), get('A'), 'before')).toBeNull();
  });

  it('before/after the root returns null', () => {
    const {at, root, get} = make();
    expect(at.moveNodeRelative(get('A'), root, 'before')).toBeNull();
    expect(at.moveNodeRelative(get('A'), root, 'after')).toBeNull();
  });
});

// ───────────────────────── setNewTree ─────────────────────────

describe('setNewTree', () => {
  it('replaces the tree and rebuilds the array', () => {
    const {at} = make();
    const t2 = n('r2', [n('x', [n('x1')]), n('y')]);
    at.setNewTree(t2);
    expect(at.getTree()).toBe(t2);
    expect(flat(at)).toEqual(['x:0', 'x1:1', 'y:0']);
    check(at, false);
  });

  it('keeps the current mode when includeRoot is omitted', () => {
    const {at} = make({includeRoot: true});
    at.setNewTree(sample());
    expect(flat(at)[0]).toBe('root:0');
    check(at, true);
  });

  it('true → false: root is no longer in the array (regression)', () => {
    const {at, root, get} = make({includeRoot: true});
    at.setNewTree(root, false);
    const arr = at.getArray();
    expect(arr.some(i => i.node === root)).toBe(false);
    expect(at.getIndex(root)).toBeUndefined();
    expect(arr[0].node).toBe(get('A'));
    expect(arr[1].node).toBe(get('A1'));
    check(at, false);
  });

  it('false → true on the same tree', () => {
    const {at, root} = make();
    at.setNewTree(root, true);
    expect(flat(at)[0]).toBe('root:0');
    check(at, true);
  });

  it('the mode switch works for collapse/expand afterwards', () => {
    const {at, root, get} = make({includeRoot: true});
    at.setNewTree(root, false);
    expect(at.expandNode(get('B'))).toEqual([{index: 4, removed: 0, inserted: 2}]);
    expect(at.collapseNode(root)).toEqual([]);
    check(at, false);
  });

  it('true → false with a collapsed root shows the children, false → true hides them again', () => {
    const {at, root} = make({includeRoot: true});
    at.collapseNode(root);
    at.setNewTree(root, false);
    expect(flat(at)[0]).toBe('A:0');
    check(at, false);
    at.setNewTree(root, true);
    expect(flat(at)).toEqual(['root:0']);
    check(at, true);
  });

  it('keeps ids of the same tree stable', () => {
    const {at, root} = make();
    const before = all(root).map(x => at.getNodeId(x));
    at.setNewTree(root);
    expect(all(root).map(x => at.getNodeId(x))).toEqual(before);
  });

  it('clearServices resets service fields of the previous tree', () => {
    const {at, root} = make();
    const old = all(root);
    at.setNewTree(n('r2', [n('x')]), undefined, true);
    checkDetached(at, [root]);
    expect(old.every(x => raw(x)._x_id === undefined)).toBe(true);
    check(at, false);
  });

  it('clearServices is ignored when the same tree is passed again', () => {
    const {at, root} = make();
    const ids = all(root).map(x => at.getNodeId(x));
    at.setNewTree(root, undefined, true);
    expect(all(root).map(x => at.getNodeId(x))).toEqual(ids);
    check(at, false);
  });
});

// ───────────────────────── moveTo rollback ─────────────────────────

describe('moveTo rollback', () => {
  const throwOnce = (at: ArrayTree<N>) =>
    vi.spyOn(at as any, 'insertNodeInternal')
      .mockImplementationOnce(() => { throw new Error('boom'); });

  it.each([false, true])('restores tree and array when insertion throws (includeRoot=%s)', (includeRoot) => {
    const {at, root, get, ok} = make({includeRoot});
    const a = get('A');
    const idsBefore = all(a).map(x => at.getNodeId(x));
    const arrayBefore = flat(at);
    const childrenBefore = root.children!.map(c => c.name);
    const spy = throwOnce(at);

    expect(() => at.moveNodeToIndex(a, get('C'), 0)).toThrow('boom');

    expect(spy).toHaveBeenCalledTimes(2);                       // попытка + откат
    expect(flat(at)).toEqual(arrayBefore);
    expect(root.children!.map(c => c.name)).toEqual(childrenBefore);
    expect(at.getParent(a)).toBe(root);
    expect(all(a).map(x => at.getNodeId(x))).toEqual(idsBefore); // id не потерялись
    ok();
  });

  it('restores a hidden node into its collapsed parent', () => {
    const {at, get, ok} = make();
    const b1 = get('B1');
    const arrayBefore = flat(at);
    throwOnce(at);

    expect(() => at.moveNodeToIndex(b1, get('C'), 0)).toThrow('boom');

    expect(at.getParent(b1)).toBe(get('B'));
    expect(get('B').children!.map(c => c.name)).toEqual(['B1', 'B2']);
    expect(at.getIndex(b1)).toBeUndefined();
    expect(flat(at)).toEqual(arrayBefore);
    ok();
  });

  it('restores the original position among siblings', () => {
    const {at, root, get, ok} = make();
    throwOnce(at);

    expect(() => at.moveNodeToIndex(get('B'), get('A'), 0)).toThrow('boom');

    expect(root.children!.map(c => c.name)).toEqual(['A', 'B', 'C']);
    ok();
  });

  it('moveNodeRelative uses the same rollback', () => {
    const {at, root, get, ok} = make();
    throwOnce(at);

    expect(() => at.moveNodeRelative(get('C'), get('A'), 'before')).toThrow('boom');

    expect(root.children!.map(c => c.name)).toEqual(['A', 'B', 'C']);
    ok();
  });

  it('a failed move does not break later operations', () => {
    const {at, get, ok} = make({includeRoot: false});
    throwOnce(at);
    expect(() => at.moveNodeToIndex(get('A'), get('C'), 0)).toThrow('boom');

    at.moveNodeToIndex(get('A'), get('C'), 0);
    expect(flat(at)).toEqual(['B:0', 'C:0', 'A:1', 'A1:2', 'A2:2']);
    ok();
  });
});

// ───────────────────────── randomized ─────────────────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nodeBuilder(rand: () => number) {
  let counter = 0;
  const build = (depth: number, isRoot = false): N => {
    const node: N = {name: isRoot ? 'root' : `n${counter++}`};
    if (depth < 3 && (isRoot || rand() < 0.6)) {
      const count = Math.floor(rand() * 4) + (isRoot ? 2 : 0);
      node.children = Array.from({length: count}, () => build(depth + 1));
    }
    if (!isRoot) {
      if (rand() < 0.2) node.collapsed = true;
      if (rand() < 0.12) node.filtered = true;
    }
    return node;
  };
  return build;
}

describe('randomized operations keep the array consistent', () => {
  const seeds = Array.from({length: 25}, (_, i) => i + 1);
  const cases = seeds.flatMap(seed => [
    {seed, includeRoot: false},
    {seed, includeRoot: true},
  ]);

  const OPS = ['insert', 'delete', 'moveToIndex', 'collapse', 'expand', 'moveRelative', 'reinsert', 'toggleMode'];

  it.each(cases)('seed $seed, includeRoot=$includeRoot', ({seed, includeRoot: initialMode}) => {
    let includeRoot = initialMode;
    const rand = mulberry32(seed);
    const build = nodeBuilder(rand);
    const root = build(0, true);
    const at = new ArrayTree<N>(root, {includeRoot});
    const detached: N[] = [];
    check(at, includeRoot);

    const positions = ['before', 'after', 'inside'] as const;

    for (let step = 0; step < 250; step++) {
      const nodes = all(at.getTree());
      const pick = () => nodes[Math.floor(rand() * nodes.length)];
      const idx = () => rand() < 0.2 ? undefined : Math.floor(rand() * 8) - 1;
      const op = Math.floor(rand() * OPS.length);

      switch (op) {
        case 0:
          at.insertNode(build(1), pick(), idx());
          break;
        case 1: {
          const x = pick();
          if (x !== root) {
            at.deleteNode(x);
            detached.push(x);
          }
          break;
        }
        case 2:
          at.moveNodeToIndex(pick(), pick(), idx() ?? 0);
          break;
        case 3:
          at.collapseNode(pick());
          break;
        case 4:
          at.expandNode(pick());
          break;
        case 5:
          at.moveNodeRelative(pick(), pick(), positions[Math.floor(rand() * 3)]);
          break;
        case 6:
          if (detached.length > 0) {
            const d = detached.splice(Math.floor(rand() * detached.length), 1)[0];
            at.insertNode(d, pick(), idx());
          }
          break;
        case 7:
          includeRoot = !includeRoot;
          at.setNewTree(root, includeRoot);
          break;
      }

      try {
        check(at, includeRoot);
        checkDetached(at, detached);
      }
      catch (e) {
        throw new Error(`seed=${seed} includeRoot=${includeRoot} step=${step} op=${OPS[op]}: ${(e as Error).message}`);
      }
    }
  });
});

describe('separate TRoot type', () => {
  interface M { name: string; data?: M[]; collapsed?: boolean }
  interface R { data: M[]; selected: M | null; loading: boolean }

  const m = (name: string, data?: M[]): M => ({name, ...(data ? {data} : {})});
  const mkRoot = (): R => ({
    data: [m('A', [m('A1')]), m('B')],
    selected: null,
    loading: false,
  });
  const names = (at: ArrayTree<M, R>) => at.getArray().map(i => `${i.node.name}:${i.depth}`);

  it('builds the array without requiring root fields from TNode', () => {
    const at = new ArrayTree<M, R>(mkRoot(), {includeRoot: false, childrenFieldName: 'data'});
    expect(names(at)).toEqual(['A:0', 'A1:1', 'B:0']);
    expect(at.getTree().loading).toBe(false);
  });

  it('isRoot distinguishes the root from nodes', () => {
    const root = mkRoot();
    const at = new ArrayTree<M, R>(root, {childrenFieldName: 'data'});
    expect(at.isRoot(root)).toBe(true);
    expect(at.isRoot(root.data[0])).toBe(false);
  });

  it('isRoot is false for the old root after setNewTree', () => {
    const old = mkRoot();
    const at = new ArrayTree<M, R>(old, {childrenFieldName: 'data'});
    at.setNewTree(mkRoot());
    expect(at.isRoot(old)).toBe(false);
  });

  it('getParent of a top-level node is the root', () => {
    const root = mkRoot();
    const at = new ArrayTree<M, R>(root, {childrenFieldName: 'data'});
    const parent = at.getParent(root.data[0])!;
    expect(parent).toBe(root);
    expect(at.isRoot(parent)).toBe(true);
  });

  it('with includeRoot the first item holds the root', () => {
    const root = mkRoot();
    const at = new ArrayTree<M, R>(root, {includeRoot: true, childrenFieldName: 'data'});
    const first = at.getArray()[0];
    expect(first.depth).toBe(0);
    expect(at.isRoot(first.node)).toBe(true);
  });

  it('insert and move into the root work', () => {
    const root = mkRoot();
    const at = new ArrayTree<M, R>(root, {includeRoot: false, childrenFieldName: 'data'});
    at.insertNode(m('X'), root, 0);
    at.moveNodeToIndex(root.data[1].data![0], root, 0); // A1 -> root start
    expect(names(at)).toEqual(['A1:0', 'X:0', 'A:0', 'B:0']);
  });

  it('root state is untouched by tree operations', () => {
    const root = mkRoot();
    root.loading = true;
    const at = new ArrayTree<M, R>(root, {childrenFieldName: 'data'});
    at.insertNode(m('X'), root);
    expect(root.loading).toBe(true);
    expect(root.selected).toBeNull();
  });
});

describe('root without a children array', () => {
  const bare = (): N => ({name: 'root'});

  it('constructor does not create the array', () => {
    const root = bare();
    const at = new ArrayTree<N>(root, {includeRoot: true});
    expect(flat(at)).toEqual(['root:0']);
    expect(root.children).toBeUndefined();
    expect(at.isNodeContainer(root)).toBe(false);
  });

  it('includeRoot: false gives an empty array', () => {
    const root = bare();
    const at = new ArrayTree<N>(root, {includeRoot: false});
    expect(flat(at)).toEqual([]);
    expect(root.children).toBeUndefined();
  });

  it('setNewTree does not create the array either', () => {
    const {at} = make();
    const root = bare();
    at.setNewTree(root);
    expect(root.children).toBeUndefined();
    expect(flat(at)).toEqual([]);
  });

  it.each([false, true])('the first insert creates it (includeRoot=%s)', (includeRoot) => {
    const root = bare();
    const at = new ArrayTree<N>(root, {includeRoot});
    const x = n('X');
    at.insertNode(x, root);
    expect(root.children).toEqual([x]);
    expect(at.isNodeContainer(root)).toBe(true);
    check(at, includeRoot);
  });
});
