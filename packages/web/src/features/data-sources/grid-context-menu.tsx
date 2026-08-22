/**
 * The grid's right-click menu.
 *
 * Worth replacing rather than accepting as it comes, for two reasons. It is the
 * only way to delete a row in this editor, so it is not a corner of the UI
 * anybody can afford to skip; and the library's own version renders English
 * labels on a hard-coded white background with black text — readable in the
 * light theme by accident, a white slab in the dark one.
 *
 * Only the labels are ours. The actions, the positioning and the
 * click-outside-to-close all stay with the library.
 */
import {
  createContextMenuComponent,
  type ContextMenuComponentProps,
  type ContextMenuItem,
} from 'react-datasheet-grid'
import { copy } from '../../i18n/index.ts'

export function renderMenuItem(item: ContextMenuItem): React.ReactNode {
  const menu = copy.dataSources.menu
  switch (item.type) {
    case 'CUT':
      return menu.cut
    case 'COPY':
      return menu.copy
    case 'PASTE':
      return menu.paste
    case 'DELETE_ROW':
      return menu.deleteRow
    case 'DELETE_ROWS':
      return menu.deleteRows(item.fromRow, item.toRow)
    case 'INSERT_ROW_BELLOW':
      return menu.insertRowBelow
    case 'DUPLICATE_ROW':
      return menu.duplicateRow
    case 'DUPLICATE_ROWS':
      return menu.duplicateRows(item.fromRow, item.toRow)
  }
}

const Menu = createContextMenuComponent(renderMenuItem)

/**
 * Wrapped rather than exported straight from the factory: the library types it
 * as an `FC`, whose return type React 19 widened to include `undefined` and
 * promises, while the grid prop still wants `ReactElement`. Rendering it inside
 * a component of our own narrows that without a cast.
 */
export function GridContextMenu(props: ContextMenuComponentProps): React.ReactElement {
  return <Menu {...props} />
}
