"use client";
import * as React from "react";
import { User, Split, Merge, Trash2, Check } from "lucide-react";
import * as Popover from "@/components/ui/popover";
import * as Tooltip from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Segment, Speaker, EditorAction } from "@/lib/editor/reducer";

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
export function SegmentActions({ seg, speakers, dispatch }: SegmentActionsProps) {
  const toast = useToast();
  const [bulk, setBulk] = React.useState(false);
  const sourceSpeaker = speakers.find((sp) => sp.id === seg.speaker);

  const onReassign = (toSpeakerId: string, useBulk: boolean) => {
    if (toSpeakerId === seg.speaker) return;
    dispatch({ type: "reassign_segment", segmentId: seg.id, toSpeakerId, bulk: useBulk });
    if (useBulk && sourceSpeaker) {
      const dest = speakers.find((sp) => sp.id === toSpeakerId);
      toast.show(`Merged ${sourceSpeaker.label} into ${dest?.label ?? toSpeakerId}`);
    } else {
      toast.show("Segment reassigned");
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
                  <Button variant="ghost" size="icon" aria-label="Reassign speaker">
                    <User size={12} aria-hidden />
                  </Button>
                }
              />
            }
          />
          <Tooltip.Panel>Reassign speaker</Tooltip.Panel>
        </Tooltip.Root>
        <Popover.Panel>
          <div className="flex flex-col gap-1 min-w-[220px]" role="listbox" aria-label="Reassign to">
            <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wider text-(--color-fg-3)">
              Reassign to
            </div>
            {speakers.map((sp, idx) => {
              const current = sp.id === seg.speaker;
              return (
                <button
                  key={sp.id}
                  role="option"
                  aria-selected={current}
                  type="button"
                  onClick={() => onReassign(sp.id, bulk)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-(--color-bg-3) text-left"
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
                  <span className="flex-1 text-(--color-fg-1) text-sm">{sp.label}</span>
                  {current ? (
                    <Check size={14} aria-hidden style={{ color: "var(--color-accent)" }} />
                  ) : null}
                </button>
              );
            })}
            <div className="flex items-center justify-between gap-2 mt-1 px-2 py-2 border-t border-(--color-line-soft)">
              <label
                htmlFor={`bulk-${seg.id}`}
                className="text-[12px] text-(--color-fg-2)"
              >
                Apply to every {sourceSpeaker?.label ?? "speaker"} segment
              </label>
              <Switch
                checked={bulk}
                onCheckedChange={setBulk}
                aria-label="Apply to every segment of source speaker"
              />
            </div>
          </div>
        </Popover.Panel>
      </Popover.Root>

      {/* Split (D-25 second action) */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Split at cursor"
              onClick={() => {
                dispatch({ type: "split", segmentId: seg.id });
                toast.show("Segment split");
              }}
            >
              <Split size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>Split at cursor</Tooltip.Panel>
      </Tooltip.Root>

      {/* Merge with previous (D-25 third action) */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Merge with previous"
              onClick={() => {
                dispatch({ type: "merge_with_prev", segmentId: seg.id });
                toast.show("Merged with previous");
              }}
            >
              <Merge size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>Merge with previous</Tooltip.Panel>
      </Tooltip.Root>

      {/* Delete (D-25 fourth action) */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete segment"
              onClick={() => {
                dispatch({ type: "delete", segmentId: seg.id });
                toast.show("Segment deleted");
              }}
            >
              <Trash2 size={12} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>Delete segment</Tooltip.Panel>
      </Tooltip.Root>
    </div>
  );
}
