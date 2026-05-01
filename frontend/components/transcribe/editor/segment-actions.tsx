"use client";
import * as React from "react";
import { User, Split, Merge, Trash2, Check, Plus, Pencil } from "lucide-react";
import * as Popover from "@/components/ui/popover";
import * as Tooltip from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Segment, Speaker, EditorAction } from "@/lib/editor/reducer";
import { useI18n, format } from "@/lib/i18n/i18n-context";

interface SegmentActionsProps {
  seg: Segment;
  speakers: Speaker[];
  dispatch: (action: EditorAction) => void;
}

/**
 * Hover-revealed action row + reassign popover.
 * Action ordering per D-25: Reassign / Split / Merge with previous / Delete.
 *
 * Spec: editor.jsx lines 480-542.
 */
/** Read the caret offset within the currently-focused (or last-selected)
 *  contentEditable Segment text host. Returns null if no in-segment range
 *  exists. The host is identified by role="textbox" + aria-label="Segment
 *  text", which EditableText sets. */
function readCaretOffsetWithinSegment(): number | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let host: HTMLElement | null =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  while (
    host &&
    !host.matches?.('[role="textbox"][aria-label="Segment text"]')
  ) {
    host = host.parentElement;
  }
  if (!host) return null;
  // Compute char offset from start of host to caret.
  const pre = document.createRange();
  pre.selectNodeContents(host);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

export function SegmentActions({
  seg,
  speakers,
  dispatch,
}: SegmentActionsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [bulk, setBulk] = React.useState(false);
  // Tracks which speaker row in the popover is being renamed inline.
  // null = not editing; otherwise the speaker.id whose row shows the input.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const sourceSpeaker = speakers.find((sp) => sp.id === seg.speaker);
  // Snapshot the caret offset on mousedown of the Split button. Some browsers
  // (Safari) drop the active selection between mousedown and click; the ref
  // is the safety net. We clear it after every dispatch.
  const caretIndexRef = React.useRef<number | null>(null);

  const onReassign = (toSpeakerId: string, useBulk: boolean) => {
    if (toSpeakerId === seg.speaker) return;
    dispatch({
      type: "reassign_segment",
      segmentId: seg.id,
      toSpeakerId,
      bulk: useBulk,
    });
    // Per-segment reassigns get no toast — the speaker chip swap on the row
    // is enough feedback (item 7 of "things to change 2.txt"). Bulk merges
    // delete a whole speaker from the rail, which is destructive enough to
    // warrant the visible confirmation.
    if (useBulk && sourceSpeaker) {
      const dest = speakers.find((sp) => sp.id === toSpeakerId);
      toast.show(
        `Merged ${sourceSpeaker.label} into ${dest?.label ?? toSpeakerId}`,
      );
    }
  };

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover/segment:opacity-100 transition-opacity duration-150">
      {/* Reassign — popover (D-25 first action) */}
      <Popover.Root>
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Popover.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.editor_reassign_speaker_aria}
                  >
                    <User size={12} aria-hidden />
                  </Button>
                }
              />
            }
          />
          <Tooltip.Panel>{t.editor_reassign_speaker_aria}</Tooltip.Panel>
        </Tooltip.Root>
        <Popover.Panel>
          <div
            className="flex flex-col gap-1 min-w-[220px]"
            role="listbox"
            aria-label={t.editor_reassign_to_label}
          >
            <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wider text-(--color-fg-3)">
              {t.editor_reassign_to_label}
            </div>
            {speakers.map((sp, idx) => {
              const current = sp.id === seg.speaker;
              const isEditing = editingId === sp.id;
              if (isEditing) {
                // Inline rename: a tiny form so the user can fix bad
                // diarization labels without leaving the assign popover.
                // Submitting commits + exits edit mode; Escape cancels.
                return (
                  <form
                    key={sp.id}
                    role="group"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = (
                        e.currentTarget.elements.namedItem(
                          "rename",
                        ) as HTMLInputElement | null
                      )?.value.trim();
                      if (next && next !== sp.label) {
                        dispatch({
                          type: "rename_speaker",
                          speakerId: sp.id,
                          label: next,
                        });
                      }
                      setEditingId(null);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-(--color-bg-3)"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: `var(--color-sp-${(idx % 5) + 1})`,
                        flexShrink: 0,
                      }}
                    />
                    <input
                      autoFocus
                      name="rename"
                      defaultValue={sp.label}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 bg-transparent text-(--color-fg-0) text-sm outline-none border-b border-(--color-accent-line) py-0.5"
                      aria-label={t.editor_rename_speaker_aria}
                    />
                    <button
                      type="submit"
                      className="text-[11px] text-(--color-accent) hover:underline"
                    >
                      {t.editor_rename_save}
                    </button>
                  </form>
                );
              }
              return (
                <div
                  key={sp.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-(--color-bg-3) group/sp"
                >
                  <button
                    role="option"
                    aria-selected={current}
                    type="button"
                    onClick={() => onReassign(sp.id, bulk)}
                    className="flex items-center gap-2 flex-1 text-left bg-transparent"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: `var(--color-sp-${(idx % 5) + 1})`,
                        flexShrink: 0,
                      }}
                    />
                    <span className="flex-1 text-(--color-fg-1) text-sm">
                      {sp.label}
                    </span>
                    {current ? (
                      <Check
                        size={14}
                        aria-hidden
                        style={{ color: "var(--color-accent)" }}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(sp.id)}
                    aria-label={format(t.editor_rename_speaker_label, {
                      label: sp.label,
                    })}
                    className="opacity-0 group-hover/sp:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-(--color-bg-4)"
                  >
                    <Pencil
                      size={12}
                      aria-hidden
                      style={{ color: "var(--color-fg-3)" }}
                    />
                  </button>
                </div>
              );
            })}
            {/* Add-speaker affordance inside the reassign popover (item line 39
                of Things-to-change.txt). Mirrors the reducer's nextSpeakerId
                logic so we can reassign to the new speaker in the SAME
                dispatch flow — adding then reassigning in two consecutive
                dispatches works because React batches them and the second
                action sees the first action's state. */}
            <button
              type="button"
              onClick={() => {
                const existing = new Set(speakers.map((sp) => sp.id));
                let i = speakers.length;
                while (existing.has(`S${i}`)) i++;
                const nextId = `S${i}`;
                dispatch({ type: "add_speaker" });
                dispatch({
                  type: "reassign_segment",
                  segmentId: seg.id,
                  toSpeakerId: nextId,
                  bulk: false,
                });
                toast.show(t.editor_toast_speaker_added_reassigned);
              }}
              className="flex items-center gap-2 px-2 py-1.5 mt-1 rounded hover:bg-(--color-bg-3) text-left border-t border-(--color-line-soft) pt-2"
            >
              <Plus
                size={12}
                aria-hidden
                style={{ color: "var(--color-fg-3)" }}
              />
              <span className="text-(--color-fg-2) text-sm">
                {t.editor_add_speaker}
              </span>
            </button>

            <div className="flex items-center justify-between gap-2 mt-1 px-2 py-2 border-t border-(--color-line-soft)">
              <label
                htmlFor={`bulk-${seg.id}`}
                className="text-[12px] text-(--color-fg-2)"
              >
                {sourceSpeaker
                  ? format(t.editor_apply_to_every_speaker, {
                      label: sourceSpeaker.label,
                    })
                  : t.editor_apply_to_every_fallback}
              </label>
              <Switch
                checked={bulk}
                onCheckedChange={setBulk}
                aria-label={t.editor_apply_to_every_fallback}
              />
            </div>
          </div>
        </Popover.Panel>
      </Popover.Root>

      {/* Split (D-25 second action).
          Item line 37 of Things-to-change.txt: capture the actual caret
          position from the focused contentEditable BEFORE dispatching, so
          the reducer splits at the user's click site instead of the
          time-mid-point. We snapshot the offset on mousedown (preventDefault
          stops Chrome from clearing the selection on focus shift, and
          Safari sometimes drops the range entirely between mousedown and
          click — the saved ref survives both). */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.editor_split_at_cursor}
              onMouseDown={(e) => {
                // Don't steal focus — keep the contentEditable's caret
                // intact so its range still resolves on click.
                e.preventDefault();
                caretIndexRef.current = readCaretOffsetWithinSegment();
              }}
              onClick={() => {
                // Fall back to a fresh read in case the saved ref was lost
                // (e.g. user keyboard-activated the button).
                const caretIndex =
                  caretIndexRef.current ?? readCaretOffsetWithinSegment();
                caretIndexRef.current = null;
                dispatch({
                  type: "split",
                  segmentId: seg.id,
                  caretIndex: caretIndex ?? undefined,
                });
                toast.show(t.editor_toast_segment_split);
              }}
            >
              <Split size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>{t.editor_split_at_cursor}</Tooltip.Panel>
      </Tooltip.Root>

      {/* Merge with previous (D-25 third action) */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.editor_merge_with_previous}
              onClick={() => {
                dispatch({ type: "merge_with_prev", segmentId: seg.id });
                toast.show(t.editor_toast_merged_with_previous);
              }}
            >
              <Merge size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>{t.editor_merge_with_previous}</Tooltip.Panel>
      </Tooltip.Root>

      {/* Delete (D-25 fourth action) */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t.editor_delete_segment}
              onClick={() => {
                dispatch({ type: "delete", segmentId: seg.id });
                toast.show(t.editor_toast_segment_deleted);
              }}
            >
              <Trash2 size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>{t.editor_delete_segment}</Tooltip.Panel>
      </Tooltip.Root>
    </div>
  );
}
