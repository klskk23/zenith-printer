/**
 * The gallery, assembled from two lists that know nothing of each other.
 *
 * The server has the labels; this browser has the drafts. A tile is one or
 * the other or both, and the order is the rule people rely on: anything
 * unsaved sits at the top where it cannot be forgotten, newest first; then
 * the saved labels, by name.
 */
import type { LabelIR } from '@zenith/shared'
import type { DraftIndexEntry } from '../drafts/schema.ts'
import type { Template } from './hooks.ts'

export type GalleryKind =
  /** A label never saved: exists only as a draft here. */
  | 'unsaved-new'
  | 'saved'
  /** Saved, and edited here since. */
  | 'saved-with-draft'
  /** A draft of a label the server no longer has. */
  | 'orphan-draft'
  /** A draft that could not be read. Shown so it can be cleared. */
  | 'corrupt-draft'

export interface GalleryItem {
  /** The draft id or the template id — what the editor is opened with. */
  key: string
  kind: GalleryKind
  name: string | null
  templateId: string | null
  widthMm: number
  heightMm: number
  /** For the picture: the saved label's content, or nothing for a bare draft entry. */
  template: Template | null
  createdAt: string
}

const collator = new Intl.Collator('zh-CN')

export function galleryItems(
  templates: readonly Template[],
  drafts: readonly DraftIndexEntry[],
  corrupt: readonly string[],
): GalleryItem[] {
  const draftByTemplate = new Map(drafts.filter((d) => d.templateId !== null).map((d) => [d.templateId!, d]))
  const templateIds = new Set(templates.map((t) => t.id))

  const unsaved: GalleryItem[] = drafts
    .filter((draft) => draft.templateId === null)
    .map((draft) => ({
      key: draft.draftId,
      kind: 'unsaved-new',
      name: draft.name,
      templateId: null,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      template: null,
      createdAt: draft.createdAt,
    }))

  const orphans: GalleryItem[] = drafts
    .filter((draft) => draft.templateId !== null && !templateIds.has(draft.templateId))
    .map((draft) => ({
      key: draft.draftId,
      kind: 'orphan-draft',
      name: draft.name,
      templateId: draft.templateId,
      widthMm: draft.widthMm,
      heightMm: draft.heightMm,
      template: null,
      createdAt: draft.createdAt,
    }))

  const broken: GalleryItem[] = corrupt.map((draftId) => ({
    key: draftId,
    kind: 'corrupt-draft',
    name: null,
    templateId: null,
    widthMm: 1,
    heightMm: 1,
    template: null,
    createdAt: '',
  }))

  const saved: GalleryItem[] = templates.map((template) => {
    const draft = draftByTemplate.get(template.id)
    return {
      key: template.id,
      kind: draft === undefined ? 'saved' : 'saved-with-draft',
      name: template.name,
      templateId: template.id,
      // The draft may have resized the label; the tile shows what opening it finds.
      widthMm: draft?.widthMm ?? template.widthMm,
      heightMm: draft?.heightMm ?? template.heightMm,
      template,
      createdAt: template.createdAt,
    }
  })

  const newestFirst = (a: GalleryItem, b: GalleryItem): number => b.createdAt.localeCompare(a.createdAt)
  const byName = (a: GalleryItem, b: GalleryItem): number => collator.compare(a.name ?? '', b.name ?? '')

  return [
    ...unsaved.sort(newestFirst),
    ...orphans.sort(newestFirst),
    ...broken,
    ...saved.sort(byName),
  ]
}

/** The IR a tile draws: the saved label's, sized as the tile says. */
export function tileIr(item: GalleryItem): LabelIR | null {
  if (item.template === null) {
    return null
  }
  return {
    widthMm: item.template.widthMm,
    heightMm: item.template.heightMm,
    dpi: item.template.dpi,
    elements: item.template.elements,
  }
}
