export type MovePosition = "before" | "after" | "inside";
export type AnyNode = Record<string, any>;

export interface IArrayItem<TNode extends object> {
  readonly node: TNode;
  readonly depth: number;
  readonly id: number;
}

export interface IArrayTreeOptionsRequired {
  childrenFieldName: string;
  collapsedFieldName: string;
  filteredFieldName: string;
  indexNodeFieldName: string;
  parentFieldName: string;
  idFieldName: string;
  includeRoot?: boolean;
}

export type IArrayTreeOptions = Partial<IArrayTreeOptionsRequired>;

export interface IArrayTreeOptionsRequired {
  childrenFieldName: string,
  collapsedFieldName: string,
  filteredFieldName: string,
  indexNodeFieldName: string,
  parentFieldName: string,
  idFieldName: string,
  arrayIdFieldName: string,
}

export interface IArrayChange {
  index: number;
  removed: number;
  inserted: number;
}
