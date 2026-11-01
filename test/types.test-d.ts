import {describe, expectTypeOf, it} from 'vitest';
import {ArrayTree} from '../src/array_tree.js';

interface M { name: string; data?: M[]; collapsed?: boolean }
interface R { data: M[]; selected: M | null; loading: boolean }

describe('types', () => {
  const root: R = {data: [], selected: null, loading: false};
  const at = new ArrayTree<M, R>(root, {childrenFieldName: 'data'});
  const node: M = {name: 'x'};

  it('getTree returns TRoot', () => {
    expectTypeOf(at.getTree()).toEqualTypeOf<R>();
  });

  it('getParent returns TNode | null | undefined', () => {
    expectTypeOf(at.getParent(node)).toEqualTypeOf<M | null | undefined>();
  });

  it('root is accepted as a target but not as a moved node', () => {
    at.insertNode(node, root);
    at.moveNodeToIndex(node, root, 0);
    // @ts-expect-error the root cannot be deleted
    at.deleteNode(root);
    // @ts-expect-error the root cannot be inserted
    at.insertNode(root, node);
  });

  it('isRoot narrows to TRoot', () => {
    const x = node as M | R;
    if (at.isRoot(x)) {
      expectTypeOf(x).toEqualTypeOf<R>();
    } else {
      expectTypeOf(x).toEqualTypeOf<M>();
    }
  });
});
