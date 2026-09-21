/**
 * The gallery's rows, in the order people rely on.
 *
 * Small on purpose: the list is the server's labels, sorted by name with a
 * Chinese-aware collator so 「出货面单」 and 「货架标签」 come out the way a
 * person would order them. There is no unsaved state to merge in — leaving
 * the editor abandons its edits, so the gallery shows only what is saved.
 */
import type { LabelIR } from '@zenith/shared'
import type { Template } from './hooks.ts'

export interface GalleryItem {
  key: string
  name: string
  widthMm: number
  heightMm: number
  template: Template
}

const collator = new Intl.Collator('zh-CN')

export function galleryItems(templates: readonly Template[]): GalleryItem[] {
  return templates
    .map((template) => ({
      key: template.id,
      name: template.name,
      widthMm: template.widthMm,
      heightMm: template.heightMm,
      template,
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/** The IR a tile draws. */
export function tileIr(item: GalleryItem): LabelIR {
  return {
    widthMm: item.template.widthMm,
    heightMm: item.template.heightMm,
    dpi: item.template.dpi,
    elements: item.template.elements,
  }
}
