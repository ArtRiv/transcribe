import type { EditorState } from "@/lib/editor/reducer";

/** Pretty-printed JSON of EditorState — round-trippable per EXPORT-04 + §10.15. */
export function renderJson(state: EditorState): string {
  return JSON.stringify(state, null, 2);
}
