export * from './selection';
// export * from './selection-api'; 削除
import {
  ISceneItemNode,
} from 'services/scenes';

export interface ISelectionState {
  selectedIds: string[];
  lastSelectedId: string;
}

/**
 * list of ISceneNode.id or ISceneNode
 */
export type TNodesList = string | string[] | ISceneItemNode | ISceneItemNode[];
