import {type AnyNode, type IArrayChange, type IArrayItem, type IArrayTreeOptions, type MovePosition,} from "./types.js";
import {getId} from "./ids_factory.js";

/**
 * Tree with a synchronized flat array of the visible nodes (for virtual lists, tree views, etc.).
 *
 * The tree is adopted and mutated in place: service fields (id, parent, array index) are written
 * straight into the nodes, so the same objects live in the tree and in the array.
 * A node is visible (present in the array) when it is not filtered, none of its ancestors is
 * collapsed or filtered, and it is not hidden by the `includeRoot` mode.
 *
 * Methods that change the array return `IArrayChange[]`. Apply the changes in order: the index of
 * each change refers to the array state after the previous one.
 *
 * @see {@link https://github.com/Web-Dev-SK/array-tree#readme Documentation}
 *
 * @template TNode - type of any node of the tree (a union if there are several kinds)
 * @template TRoot - type of the root; `getTree()` returns it
 */
export class ArrayTree<TNode extends object = {}, TRoot extends object = TNode> {
  private array: IArrayItem<TNode>[] = [];
  private tree: TRoot;
  private readonly childrenFieldName: string;
  private readonly collapsedFieldName: string;
  private readonly filteredFieldName: string;
  private readonly indexNodeFieldName: string;
  private readonly parentFieldName: string;
  private readonly idFieldName: string;
  private includeRoot: boolean;

  //CONSTRUCTOR
  /**
   * @param tree - source tree. It is NOT copied: ids, parents and indexes are written into it.
   *   Nodes that already have an id keep it.
   * @param options - names of the node fields and the mode.
   *   `includeRoot` (default `true`): put the root into the array as the first item (depth 0,
   *   its children start at depth 1). With `false` the root is virtual and top-level nodes
   *   have depth 0.
   */
  constructor(tree: TRoot, options: IArrayTreeOptions = {}) {
    this.childrenFieldName = options?.childrenFieldName ?? 'children';
    this.collapsedFieldName = options?.collapsedFieldName ?? 'collapsed';
    this.filteredFieldName = options?.filteredFieldName ?? 'filtered';
    this.indexNodeFieldName = options?.indexNodeFieldName ?? '_x_array_ind';
    this.parentFieldName = options?.parentFieldName ?? '_x_parent';
    this.idFieldName = options?.idFieldName ?? '_x_id';
    this.includeRoot = options?.includeRoot ?? true;
    this.tree = tree;
    this.setTreeRequires(tree);
    this.rebuildArray();
  }

  //PUBLIC
  /**
   * Flat array of the visible nodes in display order.
   * This is a live reference: it is modified in place by expand/collapse/insert/delete/move and
   * replaced by a new object in `setNewTree`. Do not modify it from outside, and re-read it after
   * `setNewTree`.
   */
  public getArray(): IArrayItem<TNode>[] {
    return this.array;
  }

  /** The root node, the same object that was passed to the constructor or `setNewTree`. */
  public getTree(): TRoot {
    return this.tree;
  }

  /**
   * Replace the tree and rebuild the array from scratch. Slow: walks the whole tree.
   * @param tree - new tree (not copied, see the constructor)
   * @param includeRoot - new root mode. If omitted, the current mode is kept.
   * @param clearServices - clear service fields (id, parent, index) of the previous tree, so its
   *  nodes can be reused elsewhere. Ignored if the same tree is passed again.
   */
  public setNewTree(tree: TRoot, includeRoot: boolean = this.includeRoot, clearServices: boolean = false) {
    if (!Array.isArray(this.getChildren(tree))) {
      this.setChildren(tree, []);
    }
    if (clearServices && tree !== this.tree) {
      this.clearServiceFields(this.tree);
    }
    this.tree = tree;
    this.includeRoot = includeRoot;
    this.setTreeRequires(tree);
    this.rebuildArray();
  }

  /**
   * Returns the ancestor of the node (or the node itself) that is a direct child of the root.
   * For the root returns the root. Typed as TNode, check with isRoot.
   */
  public getTopNonRootNode(node: TNode | TRoot): TNode {
    let cur: TNode | TRoot = node;
    let parent = this.getParent(cur);
    while (parent && this.getParent(parent)) {
      cur = parent;
      parent = this.getParent(cur);
    }
    return cur as TNode;
  }

  /**
   * Collapse the node: set its collapsed flag and remove its descendants from the array.
   * The flag is set even if the node itself is not visible (it takes effect when it becomes visible).
   * The root can be collapsed only with `includeRoot`.
   * @returns the removed range, or `[]` if the node cannot be toggled, is already collapsed,
   *   is not visible, or has no visible descendants
   */
  public collapseNode(node: TNode | TRoot): IArrayChange[] {
    if (!this.canToggle(node) || this.isCollapsed(node)) {
      return [];
    }
    const curIndex = this.getIndex(node);
    this.setCollapsed(node, true);
    if (curIndex === undefined) {
      return [];
    }
    const lastIndex = this.getSubtreeEndIndex(curIndex);
    const removed = lastIndex - curIndex - 1;
    if (removed <= 0) {
      return [];
    }
    for (let ind = curIndex + 1; ind < lastIndex; ind++) {
      this.clearIndex(this.array[ind].node);
    }
    this.array.splice(curIndex + 1, removed);
    this.reindexNodesFrom(curIndex + 1);
    return [{index: curIndex + 1, removed, inserted: 0}];
  }

  /**
   * Expand the node: clear its collapsed flag and insert its visible descendants into the array.
   * Nested collapsed nodes stay collapsed. The flag is cleared even if the node is not visible.
   * The root can be expanded only with `includeRoot`.
   * @returns the inserted range, or `[]` if the node cannot be toggled, is not collapsed,
   *   is not visible, or has nothing to show
   */
  public expandNode(node: TNode | TRoot): IArrayChange[] {
    if (!this.canToggle(node) || !this.isCollapsed(node)) {
      return [];
    }
    const curIndex = this.getIndex(node);
    this.setCollapsed(node, false);
    if (curIndex === undefined) {
      return [];
    }
    const arr: IArrayItem<TNode>[] = [];
    this.getAllChildrenArray(arr, node, this.array[curIndex].depth + 1);
    if (arr.length === 0) {
      return [];
    }
    this.array.splice(curIndex + 1, 0, ...arr);
    this.reindexNodesFrom(curIndex + 1);
    return [{index: curIndex + 1, removed: 0, inserted: arr.length}];
  }

  /**
   * Insert a NEW node (with its subtree) into the children of `targetNode`.
   * A node that is already in the tree must be relocated with `moveNodeToIndex` or
   * `moveNodeRelative`.
   * The array changes only if the node is not filtered and the target is visible, expanded and
   * not filtered; otherwise the node is added to the tree only.
   * The children array of the target is created if missing.
   * @param node - node to insert; neither it nor its descendants may have an id
   * @param targetNode - container
   * @param index - position among the target's children; out of range or omitted means the end
   * @returns the inserted range, or `[]` if the array did not change
   * @throws if the node or any descendant already has an id
   */
  public insertNode(node: TNode, targetNode: TNode | TRoot, index?: number): IArrayChange[] {
    if (this.hasIds(node)) {
      throw new Error("It is impossible to insert a node that has an id");
    }

    const res = this.insertNodeInternal(node, targetNode, index, false);
    return res.index > -1 ? [{index: res.index, removed: 0, inserted: res.length}] : [];
  }

  /**
   * Remove the node with its subtree from the tree and from the array. The root cannot be deleted
   * and a detached node is ignored. Service fields (id, parent, index) of the node and all its
   * descendants are cleared; user data is kept.
   * @param node - node to delete
   * @param dontReindex - skip updating the indexes of the following array items. Use it for batch
   *   deletes and then call `reindexFromNode` with a node located before the deleted ones.
   *   Until then `getIndex` returns `undefined` for the shifted nodes.
   * @returns the removed range, or `[]` if the node was not visible, is the root or is detached
   */
  public deleteNode(node: TNode, dontReindex = false): IArrayChange[] {
    if (!this.getParent(node)) {
      return [];
    }
    const r = this.deleteNodeInternal(node, dontReindex);
    this.clearServiceFields(node);
    return r.index > -1 ? [{index: r.index, removed: r.length, inserted: 0}] : [];
  }

  /**
   * Whether `node` can be moved into `targetNode`: it must not be the root, and the target must
   * not be the node itself or its descendant.
   */
  public canMoveNode(node: TNode, targetNode: TNode | TRoot): boolean {
    return !!this.getParent(node) && !this.isNodeParentOf(node, targetNode);
  }

  /**
   * Move the node to `targetNode` in the tree and in the array.
   * @param node - node to move
   * @param targetNode - new container
   * @param index - position among the target's children, counted AFTER the node is removed from
   *   its old parent (matters when moving inside the same parent). Out of range means the end.
   * @returns `null` if the move is not allowed (see `canMoveNode`); otherwise up to two changes:
   *   the removal from the old place, then the insertion (its index refers to the array after
   *   the removal). A hidden node or a hidden target yields fewer changes.
   *   If the insertion throws, the old state is restored and the error is rethrown.
   */
  public moveNodeToIndex(node: TNode, targetNode: TNode | TRoot, index: number): IArrayChange[] | null {
    return this.moveTo(node, targetNode, () => index);
  }

  /**
   * Whether `targetNode` is `node` itself or one of its ancestors.
   * Note the argument order: the potential ancestor goes first.
   */
  public isNodeParentOf(targetNode: TNode | TRoot, node: TNode | TRoot) {
    let cur: TNode | TRoot | null | undefined = node;
    while (cur) {
      if ((cur as object) === targetNode) {
        return true;
      }
      cur = this.getParent(cur);
    }
    return false;
  }

  /** Children array of the node (live reference), or `undefined` if the node has none. */
  public getChildren(node: TNode | TRoot): TNode[] | undefined {
    return (node as AnyNode)[this.childrenFieldName];
  }

  /**
   * Move the node relative to a reference node.
   * @param node - node to move
   * @param referenceNode - the node to position against
   * @param position - `"before"` / `"after"`: become a sibling of `referenceNode`;
   *   `"inside"`: become the last child of `referenceNode`
   * @returns `null` if `node === referenceNode`, if `referenceNode` is the root with
   *   `"before"`/`"after"`, or if the move is not allowed; otherwise as in `moveNodeToIndex`
   */
  public moveNodeRelative(node: TNode, referenceNode: TNode | TRoot, position: MovePosition): IArrayChange[] | null {
    if ((node as object) === referenceNode) {
      return null;
    }
    if (position === "inside") {
      return this.moveTo(node, referenceNode, () => undefined);
    }
    if (this.isRoot(referenceNode)) {
      return null;
    }
    const ref = referenceNode;
    const parent = this.getParent(ref);
    if (!parent) {
      return null;
    }
    return this.moveTo(node, parent, () => {
      const i = this.getChildren(parent)!.indexOf(ref);
      return position === "before" ? i : i + 1;
    });
  }

  /**
   * Expand all collapsed ancestors of the node (from the root down), and the node itself if it is
   * collapsed. Use it to reveal a node.
   * @returns the changes of every expansion, in the order they must be applied
   */
  public expandNodeAndParents(node: TNode | TRoot) {
    const changes: IArrayChange[] = [];
    const path = this.getPathToRoot(node);
    while (path.length > 0) {
      const cur = path.pop();
      if (cur && this.isCollapsed(cur)) {
        changes.push(...this.expandNode(cur));
      }
    }
    return changes;
  }

  /** Whether the node has a children array (an empty array counts as a container). */
  public isNodeContainer(node: TNode | TRoot) {
    return Array.isArray(this.getChildren(node));
  }

  /**
   * Refresh the array indexes of all items starting from the position of `node`.
   * Needed after `deleteNode(..., true)`. Does nothing if the node is not in the array,
   * so pass a node that is still visible.
   */
  public reindexFromNode(node: TNode | TRoot) {
    const index = this.getIndex(node);
    if (index !== undefined && index > -1) {
      this.reindexNodesFrom(index);
    }
  }

  /** Whether the node is the root of this tree. Type guard: narrows to TRoot. */
  public isRoot(node: TNode | TRoot): node is TRoot {
    return (node as object) === this.tree;
  }

  //Private
  private rebuildArray() {
    const arr: IArrayItem<TNode>[] = [];
    if (this.includeRoot) {
      const rootItem = this.createNewItem(this.tree, 0);
      this.setIndex(this.tree, arr.push(rootItem) - 1);
      this.getAllChildrenArray(arr, this.tree, 1);
    }
    else {
      this.getAllChildrenArray(arr, this.tree, 0);
    }
    this.array = arr;
  }

  private createNewItem(node: TNode | TRoot, depth: number): IArrayItem<TNode> {
    const id = this.getNodeId(node);
    if (id === undefined) {
      throw new Error("Node has no id");
    }
    return {node: node as TNode, depth, id};
  }

  private canToggle(node: TNode | TRoot): boolean {
    return this.isRoot(node) ? this.includeRoot : !!this.getParent(node);
  }

  private clearServiceFields(node: TNode | TRoot) {
    this.setNodeId(node, undefined);
    this.setParent(node, undefined);
    this.clearIndex(node);
    for (const child of this.getChildren(node) ?? []) {
      this.clearServiceFields(child);
    }
  }

  private deleteNodeInternal(node: TNode, dontReindex = false) {
    let result = {
      index: -1,
      length: 0,
    };
    const parent = this.getParent(node);
    if (!parent) {
      return result;
    }
    this.setParent(node, undefined);
    let itemIndex = this.getIndex(node);
    if (itemIndex !== undefined && itemIndex > -1) {
      const end = this.getSubtreeEndIndex(itemIndex);
      const length = end - itemIndex;
      const removed = this.array.splice(itemIndex, length);
      for (const item of removed) {
        this.clearIndex(item.node);
      }
      if (!dontReindex) {
        this.reindexNodesFrom(itemIndex);
      }
      result = {index: itemIndex, length: length};
    }
    const children = this.getChildren(parent);
    if (children) {
      const nodeIndex = children.indexOf(node);
      if (nodeIndex > -1) {
        children.splice(nodeIndex, 1);
      }
    }
    return result;
  }

  private moveTo(node: TNode, target: TNode | TRoot, resolveIndex: () => number | undefined): IArrayChange[] | null {
    if (!this.canMoveNode(node, target)) {
      return null;
    }
    const oldParent = this.getParent(node)!;
    const oldIndex = this.getChildren(oldParent)!.indexOf(node);
    const del = this.deleteNodeInternal(node);
    let ins: { index: number; length: number };
    try {
      ins = this.insertNodeInternal(node, target, resolveIndex(), true);
      if (ins.index > -1) {
        this.reindexNodesFrom(ins.index);
      }
    } catch (err) {
      this.setParent(node, undefined);
      this.clearNodeIndexes(node);
      this.insertNodeInternal(node, oldParent, oldIndex, false);
      throw err;
    }
    const changes: IArrayChange[] = [];
    if (del.index > -1) {
      changes.push({index: del.index, removed: del.length, inserted: 0});
    }
    if (ins.index > -1) {
      changes.push({index: ins.index, removed: 0, inserted: ins.length});
    }
    return changes;
  }

  private setTreeRequires(node: TNode | TRoot, parent?: TNode | TRoot) {
    this.setParent(node, parent ?? null);
    this.clearIndex(node);
    if (this.getNodeId(node) === undefined) {
      this.setNodeId(node, getId());
    }
    const children = this.getChildren(node);
    if (children) {
      for (const child of children) {
        this.setTreeRequires(child, node);
      }
    }
  }

  private getAllChildrenArray(array: IArrayItem<TNode>[], node: TNode | TRoot, depth: number) {
    const isVirtualRoot = this.isRoot(node) && !this.includeRoot;
    if (this.isFiltered(node) || (!isVirtualRoot && this.isCollapsed(node))) {
      return;
    }
    const children = this.getChildren(node);
    if (!Array.isArray(children)) {
      return;
    }
    for (const child of children) {
      if (!this.isFiltered(child)) {
        const item = this.createNewItem(child, depth);
        this.setIndex(child, array.push(item) - 1);
        this.getAllChildrenArray(array, child, depth + 1);
      }
    }
  }

  private reindexNodesFrom(index: number) {
    const thisArray = this.array;
    for (let ind = index; ind < thisArray.length; ind++) {
      this.setIndex(thisArray[ind].node, ind);
    }
  }

  private getPathToRoot(node: TNode | TRoot) {
    const arr = [node];
    let parent = this.getParent(node);
    while (parent) {
      arr.push(parent)
      parent = this.getParent(parent);
    }
    return arr;
  }

  private getSubtreeEndIndex(nodeIndex: number): number {
    const thisArray = this.array;
    const curDepth = thisArray[nodeIndex]!.depth;
    let ind = nodeIndex + 1;
    while (ind < thisArray.length && thisArray[ind]!.depth > curDepth) {
      ind++;
    }
    return ind;
  }

  //return the index of the next node less or equal depth
  //if the node is not found, it returns the last element index + 1
  private getNextNodeIndexInArray(depth: number, startIndex: number = 0) {
    const thisArray = this.array;
    for (let index = startIndex + 1; index < thisArray.length; index++) {
      const item = thisArray[index];
      if (item.depth <= depth) {
        return index;
      }
    }
    return thisArray.length;
  }

  private insertNodeInternal(
    node: TNode,
    targetNode: TNode | TRoot,
    index?: number,
    dontReindex?: boolean
  ) {
    if (this.getParent(node)) {
      throw new Error("Node already has parent");
    }
    if (this.isNodeParentOf(node, targetNode)) {
      throw new Error("Cannot insert a node into itself or its descendant");
    }
    let children = this.getChildren(targetNode);
    if (!children) {//if no array of children, create it
      children = [];
      this.setChildren(targetNode, children);
    }
    const insertIndex = index === undefined || index < 0 || index > children.length
      ? children.length
      : index;
    let startIndex = -1;
    let insertLength = 0;
    this.setTreeRequires(node, targetNode);

    //ARRAY
    const nodeFiltered = this.isFiltered(node);
    const insertToRoot = !this.includeRoot && this.isRoot(targetNode);
    const targetVisible = insertToRoot || this.getIndex(targetNode) !== undefined;
    if (!nodeFiltered
      && targetVisible
      && (insertToRoot || !this.isCollapsed(targetNode))
      && !this.isFiltered(targetNode)
    ) {
      const thisArray = this.array;
      const targetNodeIndex = this.getIndex(targetNode);
      let targetNodeDepth: number;
      if (insertToRoot) {
        targetNodeDepth = -1;
      }
      else {
        if (targetNodeIndex === undefined) {
          throw new Error("Target node is visible, but has no index");
        }
        targetNodeDepth = thisArray[targetNodeIndex]!.depth;
      }

      if (insertIndex >= children.length) {
        startIndex = this.getNextNodeIndexInArray(targetNodeDepth, targetNodeIndex);
      }
      else {
        const childNode = children[insertIndex]
        if (!this.isFiltered(childNode)) { //if node visible
          startIndex = this.getVisibleIndex(childNode);
        }
        else {
          let nearestNodeIndex = -1;
          let ind = insertIndex;
          while (ind < children.length) {
            if (!this.isFiltered(children[ind])) {
              nearestNodeIndex = ind;
              break;
            }
            ind++;
          }
          if (nearestNodeIndex > -1) {
            startIndex = this.getVisibleIndex(children[nearestNodeIndex]);
          }
          else {//not found
            startIndex = this.getNextNodeIndexInArray(targetNodeDepth, targetNodeIndex);
          }
        }
      }
      const item = this.createNewItem(node, targetNodeDepth + 1);
      const arr: IArrayItem<TNode>[] = [item];
      const nodeChildren = this.getChildren(node);
      if (!this.isCollapsed(node) && Array.isArray(nodeChildren) &&
        nodeChildren.length > 0) {
        this.getAllChildrenArray(arr, node, item.depth + 1);
      }
      thisArray.splice(startIndex, 0, ...arr);
      if (!dontReindex) {
        this.reindexNodesFrom(startIndex);
      }
      insertLength = arr.length;
    }
    else {
      this.clearNodeIndexes(node);
    }
    //END ARRAY CHANGES
    children.splice(insertIndex, 0, node);
    return {index: startIndex, length: insertLength};
  }

  private clearNodeIndexes(node: TNode) {
    this.clearIndex(node);
    const children = this.getChildren(node);
    if (Array.isArray(children)) {
      for (const child of children) {
        this.clearNodeIndexes(child);
      }
    }
  }

  private hasIds(node: TNode): boolean {
    if (this.getNodeId(node) !== undefined) {
      return true;
    }
    return (this.getChildren(node) ?? []).some(c => this.hasIds(c));
  }

  //ACCESSORS
  /** Parent of the node: `null` for the root, `undefined` if detached.
   *  For a top-level node this is the root itself (typed as TNode): check with `isRoot`.
   */
  public getParent(node: TNode | TRoot): TNode | null | undefined {
    return (node as AnyNode)[this.parentFieldName];
  }

  /**
   * Position of the node in the array, or `undefined` if the node is not visible
   * (collapsed or filtered ancestor, filtered itself, root without `includeRoot`, detached)
   * or its stored index is stale.
   */
  public getIndex(node: TNode | TRoot): number | undefined {
    const res = (node as AnyNode)[this.indexNodeFieldName];
    return res !== undefined && (this.array[res]?.node as object) === node ? res : undefined;
  }

  /** Id of the node, or `undefined` if the node is not in the tree (never inserted or deleted). */
  public getNodeId(node: TNode | TRoot): number | undefined {
    return (node as AnyNode)[this.idFieldName];
  }

  /** Whether the node's collapsed flag is set. */
  public isCollapsed(node: TNode | TRoot): boolean {
    return !!(node as AnyNode)[this.collapsedFieldName];
  }

  /** Whether the node's filtered flag is set. */
  public isFiltered(node: TNode | TRoot): boolean {
    return !!(node as AnyNode)[this.filteredFieldName];
  }

  private setChildren(node: TNode | TRoot, children: TNode[]): void {
    (node as AnyNode)[this.childrenFieldName] = children;
  }

  private setParent(node: TNode | TRoot, parent: TNode | TRoot | null | undefined): void {
    (node as AnyNode)[this.parentFieldName] = parent;
  }

  private setIndex(node: TNode | TRoot, index: number): void {
    (node as AnyNode)[this.indexNodeFieldName] = index;
  }

  private clearIndex(node: TNode | TRoot): void {
    (node as AnyNode)[this.indexNodeFieldName] = undefined; // not delete: keeps the object shape stable
  }

  private setNodeId(node: TNode | TRoot, id: number | undefined): void {
    (node as AnyNode)[this.idFieldName] = id;
  }

  private setCollapsed(node: TNode | TRoot, value: boolean): void {
    (node as AnyNode)[this.collapsedFieldName] = value;
  }

  private getVisibleIndex(node: TNode): number {
    const index = this.getIndex(node);
    if (index === undefined) {
      throw new Error("Visible node has no index");
    }
    return index;
  }
}
