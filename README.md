# @webdevsk/array-tree

Represents a tree as a flat array of its **visible** nodes. Built for virtual lists and tree views: render the array, and use the returned changes to update the view incrementally.

> **Warning:** this is a beta version. The API may change without notice, and the library is not intended for production use yet.

## Install

```bash
npm install @webdevsk/array-tree
```

## Quick start

```ts
import {ArrayTree} from '@webdevsk/array-tree';

interface Item {
  name: string;
  children?: Item[];
  collapsed?: boolean;
  filtered?: boolean;
}

const root: Item = {
  name: 'root',
  children: [
    {name: 'src', collapsed: false, children: [{name: 'index.ts'}, {name: 'utils.ts'}]},
    {name: 'docs', collapsed: true, children: [{name: 'guide.md'}]},
    {name: 'package.json'},
  ],
};
const [src, docs] = root.children!;

const tree = new ArrayTree<Item>(root, {includeRoot: false});

tree.getArray().map(i => '  '.repeat(i.depth) + i.node.name);
// ['src', '  index.ts', '  utils.ts', 'docs', 'package.json']

tree.expandNode(docs);
// [{index: 4, removed: 0, inserted: 1}]   -> 'guide.md' appeared at position 4

tree.collapseNode(src);
// [{index: 1, removed: 2, inserted: 0}]   -> two rows after 'src' disappeared

tree.insertNode({name: 'README.md'}, root);
// appended at the end of the root, the array is updated
```

## Concepts

**Your flags, your data.** The tree reads `collapsed` and `filtered` from your nodes. Use `collapseNode`/`expandNode` to change `collapsed` so the array stays in sync. The library does not apply filters itself: set `filtered` on the nodes you want to hide and rebuild with `setNewTree(tree)`.

**Service fields.** The constructor adds three fields to every node: an id, a link to the parent and the index in the array. You can read them through accessors (`getNodeId`, `getParent`, `getIndex`) and must not write them.

**Root modes.**

| `includeRoot` | Array |
|---|---|
| `true` (default) | The root is the first item (depth 0), its children start at depth 1. The root can be collapsed. |
| `false` | The root is virtual: it is not in the array, top-level nodes have depth 0, and its `collapsed` flag is ignored. |

## Array items

`getArray()` returns items of type `IArrayItem`:

```ts
interface IArrayItem<TNode extends object> {
  readonly node: TNode;
  readonly depth: number;
  readonly id: number;
}
```

| Field | Description |
|---|---|
| `node` | The node itself: the same object that lives in the tree, not a copy. |
| `depth` | Nesting level of the node in the display. With `includeRoot: true` the root has depth `0` and its children `1`; with `includeRoot: false` top-level nodes have depth `0`. Items are listed in display order, so the subtree of an item is the run of following items with a greater depth |
| `id` | Unique number greater than 0. Use it as a list key or pass the array straight to libraries that expect items with an `id` |

Items are read-only. Do not modify them or the array: it is updated by the library's methods (see "Working with changes").

| `includeRoot` | Array                                                                                                           |
|---|---|
| `true` (default) | The root is the first item (depth 0), its children start at depth 1. The root can be collapsed.                 |
| `false` | The root is virtual: it is not in the array, top-level nodes have depth 0, and its `collapsed` flag is ignored. |

**Mutation in place.** The tree you pass is not copied. If you need to keep the original, clone it first.

## Options

```ts
new ArrayTree(tree, options?)
```

| Option | Default | Meaning                                                                         |
|---|---|---|
| `includeRoot` | `true` | See "Root modes" above                                                          |
| `childrenFieldName` | `'children'` | Name of the node field holding the array of child nodes                         |
| `collapsedFieldName` | `'collapsed'` | Name of the node field with the collapsed flag                                  |
| `filteredFieldName` | `'filtered'` | Name of the node field with the filtered flag                                   |
| `idFieldName` | `'_x_id'` | Name of the service field in the node where its id is stored                    |
| `parentFieldName` | `'_x_parent'` | Name of the service field in the node where its parent is stored                |
| `indexNodeFieldName` | `'_x_array_ind'` | Name of the service field in the node where its position in the array is stored |

## Working with changes

Methods that modify the array return `IArrayChange[]`:

```ts
interface IArrayChange {
  index: number;     // position in the array
  removed: number;   // how many items were removed there
  inserted: number;  // how many items were inserted there
}
```

A change works like `Array.prototype.splice`. When there are several changes, apply them **in order**: the index of each one refers to the array after the previous one. An empty result means the array did not change (for example, the node was inserted into a collapsed parent).

If you render straight from `getArray()`, you only need to re-render. For an incremental update, the inserted items are `tree.getArray().slice(index, index + inserted)`:

```ts
for (const {index, removed, inserted} of tree.collapseNode(node)) {
  mirror.splice(index, removed, ...tree.getArray().slice(index, index + inserted));
}
```

`getArray()` returns a live reference that is modified in place. `setNewTree` replaces it with a new array, so read it again afterwards. After `expandNodeAndParents`, which may return several insertions, it is simpler to resync with the whole array.

## Containers

Any node can become a container: if the target of `insertNode` or a move has no children
array, it is created automatically. The library does not restrict which nodes may have
children. If some nodes must stay leaves, check it in your code before calling.

`isNodeContainer(node)` tells whether the node has a children array right now.
Removing the last child leaves an empty array, so the node remains a container.

## API

### Creating and reading

| Method | Description |
|---|---|
| `new ArrayTree(tree, options?)` | Adopts the tree and builds the array |
| `getArray()` | Flat array of visible items (live reference) |
| `getTree()` | The root node |
| `setNewTree(tree, includeRoot?, clearServices?)` | Replaces the tree and rebuilds the array. Slow: walks the whole tree. `includeRoot` keeps the current mode if omitted. With `clearServices` the previous tree's service fields are cleared so its nodes can be reused elsewhere |

### Expanding and collapsing

| Method | Description |
|---|---|
| `collapseNode(node)` | Sets the flag and removes the visible descendants from the array |
| `expandNode(node)` | Clears the flag and inserts the visible descendants. Nested collapsed nodes stay collapsed |
| `expandNodeAndParents(node)` | Expands all collapsed ancestors (and the node). Use it to reveal a node |

The flag is set or cleared even if the node itself is not visible. The root can be toggled only with `includeRoot`.

### Changing the tree

| Method | Description |
|---|---|
| `insertNode(node, target, index?)` | Inserts a **new** node with its subtree into the target's children. Out-of-range or omitted index means the end. Throws if the node or any descendant already has an id |
| `deleteNode(node, dontReindex?)` | Removes the node with its subtree. Service fields of the whole subtree are cleared, your data is kept, so the node can be inserted again. The root cannot be deleted. With `dontReindex` the indexes of following items stay stale until you call `reindexFromNode` |
| `moveNodeToIndex(node, target, index)` | Moves the node into the target. The index is counted after the node is removed from its old parent |
| `moveNodeRelative(node, reference, position)` | Moves the node `"before"`, `"after"` or `"inside"` (as the last child) relative to the reference node |
| `canMoveNode(node, target)` | `false` for the root and for moving a node into itself or its descendant |
| `reindexFromNode(node)` | Refreshes array indexes starting from the node (after `deleteNode(..., true)`) |

Moves return `null` when they are not allowed, otherwise up to two changes: the removal, then the insertion. If the insertion throws, the previous state is restored and the error is rethrown. Ids and parents are preserved by moves.

### Reading nodes

| Method | Description |
|---|---|
| `getParent(node)` | Parent; `null` for the root, `undefined` if the node is not in the tree |
| `getNodeId(node)` | Id; `undefined` if the node is not in the tree |
| `getIndex(node)` | Position in the array, or `undefined` if the node is not visible |
| `getChildren(node)` | Children array (live reference) |
| `isCollapsed(node)` / `isFiltered(node)` | The flags |
| `isNodeContainer(node)` | Whether the node has a children array (an empty one counts) |
| `isNodeParentOf(ancestor, node)` | `true` if `ancestor` is the node itself or one of its ancestors |
| `getTopNonRootNode(node)` | The ancestor (or the node itself) that is a direct child of the root |

## TypeScript

```ts
class ArrayTree<TNode extends object = {}>
```

`TNode` is the type of any node (use a union if there are several kinds),  returns:

```ts
type Node = RootNode | FolderNode | FileNode;

const tree = new ArrayTree<Node>(rootNode);
tree.getTree().children;
```

Exported types: `IArrayItem`, `IArrayChange`, `IArrayTreeOptions`.

## Things to know

- **Reading is cheap, writing is in place.** Do not edit service fields by hand, and do not change `collapsed` or `filtered` directly on nodes that are in the array; use the methods, or rebuild with `setNewTree(tree)`.
- **Stale indexes.** `getIndex` verifies that the item at the stored index is really the node, so it returns `undefined` instead of a wrong position when the index is outdated.
- **An id is a sign of being in the tree.** That is why `insertNode` rejects nodes that already have one. To relocate a node that is already in the tree, use `moveNodeToIndex` or `moveNodeRelative`.
- **Insert into a hidden place.** Inserting into a collapsed, filtered changes the tree only and returns `[]`.
- **The array is mutated in place.** `getArray()` keeps the same reference after expand/collapse/insert/delete/move, so frameworks that compare by reference will not notice the change. Keep a version counter in your state and bump it after each call that returns changes.

## TODO

- [ ] Add inserting an array of child nodes
- [ ] Implement filtering methods
- [ ] Implement a cleanup method (remove all service fields from the tree)

## License

MIT


