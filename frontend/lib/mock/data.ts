// frontend/lib/mock/data.ts
// Canonical mock transcript payload — the schema MUST match
// backend/app/schemas.py TranscriptPayload exactly so Phase 4's
// mock→real swap is transparent.
//
// Field reshape from claude-design-code/transcribe/src/data.jsx (read-only spec):
//   speakerId → speaker, name → label, drop role/color from canonical payload,
//   id "g1"..."gN" → "seg_0001"..."seg_NNNN" per backend/app/pipeline/merge.py:30.

export interface Word {
  w: string;
  s: number; // start seconds
  e: number; // end seconds
  p?: number; // probability (optional)
}

export interface Speaker {
  id: string; // e.g. "S0", "S1"
  label: string; // human-renamed; "Speaker 1" default fallback
}

export interface Segment {
  id: string; // "seg_NNNN" zero-padded
  start: number; // seconds
  end: number;
  speaker: string; // references Speaker.id
  text: string;
  words?: Word[];
}

export interface TranscriptPayload {
  version: 1;
  language: string; // BCP-47 short, e.g. "en"
  duration_sec: number;
  speakers: Speaker[];
  segments: Segment[];
}

/**
 * Sample transcript used by MSW handlers, the Realtime stub's "succeeded"
 * emit, and exporter unit tests. Verbatim ported from
 * frontend/claude-design-code/transcribe/src/data.jsx (lines 1-79) with
 * field-name + id-format reshape per the table in PATTERNS.md.
 */
export const SAMPLE_PAYLOAD: TranscriptPayload = {
  version: 1,
  language: "en",
  duration_sec: 134.0,
  speakers: [
    { id: "S0", label: "Maya Okafor" },
    { id: "S1", label: "Jonas Rivera" },
    { id: "S2", label: "Priya Shah" },
  ],
  segments: [
    {
      id: "seg_0001",
      start: 0,
      end: 7.4,
      speaker: "S0",
      text: "Okay, thanks for jumping on. Let's walk through the new onboarding flow — Jonas pulled the prototype together over the weekend, and I want us to be honest about where it's working and where it isn't.",
    },
    {
      id: "seg_0002",
      start: 7.6,
      end: 14.2,
      speaker: "S1",
      text: "Yeah, before we dig in — the metrics goal hasn't changed. We need to get day-one activation up by about eight points, and the working hypothesis is that the third step is where we're losing people.",
    },
    {
      id: "seg_0003",
      start: 14.4,
      end: 22.9,
      speaker: "S2",
      text: "I looked at the funnel data this morning. It's actually two drop-offs, not one. There's a smaller dip on step two — like four percent — and then the big one on step three is around eighteen.",
    },
    {
      id: "seg_0004",
      start: 23.1,
      end: 31.0,
      speaker: "S0",
      text: "Right, so the prototype tries to collapse three into two, which I like in principle. But I'm worried we're hiding a decision the user actually wants to make. Can we open the first screen?",
    },
    {
      id: "seg_0005",
      start: 31.4,
      end: 39.6,
      speaker: "S1",
      text: "Sure. So this is the welcome — same as today, basically. The change starts here. Instead of asking workspace name, then team size, then plan, we ask workspace name and infer the rest.",
    },
    {
      id: "seg_0006",
      start: 39.8,
      end: 46.1,
      speaker: "S2",
      text: "Infer how, though? We don't have a signal for team size at signup. Is that a heuristic, or a guess, or…",
    },
    {
      id: "seg_0007",
      start: 46.3,
      end: 54.0,
      speaker: "S1",
      text: "It's a guess we let people correct later. The thinking is: most people fall into 'small team,' so default to that, then surface a prompt in settings if usage looks bigger.",
    },
    {
      id: "seg_0008",
      start: 54.2,
      end: 64.8,
      speaker: "S0",
      text: "I'd push back on that. Defaults are sticky, and if we put someone on the wrong plan they're going to feel that within a week. Can we make the inference visible? Like, show 'we set you up for a team of five — change this' as a banner.",
    },
    {
      id: "seg_0009",
      start: 65.0,
      end: 70.3,
      speaker: "S2",
      text: "From an implementation standpoint that's nearly free. We already render a notice strip there for billing.",
    },
    {
      id: "seg_0010",
      start: 70.5,
      end: 77.4,
      speaker: "S1",
      text: "Okay, I can live with that. It does add a tiny bit of cognitive load, but it's honest, which I think matters more here.",
    },
    {
      id: "seg_0011",
      start: 77.6,
      end: 85.2,
      speaker: "S0",
      text: "Good. Next thing — the empty state on step three. Right now it's a hero illustration with no clear next action. New users don't know if they should invite a teammate or import data first.",
    },
    {
      id: "seg_0012",
      start: 85.4,
      end: 92.0,
      speaker: "S2",
      text: "We could split it. Two equal-weight buttons, but pre-select the one that's more common based on the workspace type.",
    },
    {
      id: "seg_0013",
      start: 92.2,
      end: 99.6,
      speaker: "S1",
      text: "I'd rather not pre-select — that's the same defaults problem Maya just flagged. Just two buttons, no preference, and we measure which wins.",
    },
    {
      id: "seg_0014",
      start: 99.8,
      end: 105.4,
      speaker: "S0",
      text: "Agreed. Let's also kill the illustration. It's pretty but it's eating the fold.",
    },
    {
      id: "seg_0015",
      start: 105.6,
      end: 113.0,
      speaker: "S2",
      text: "One more thing while we're here — the loading state between steps two and three takes about eight hundred milliseconds. Long enough that people think it's broken.",
    },
    {
      id: "seg_0016",
      start: 113.2,
      end: 120.8,
      speaker: "S1",
      text: "Can we prefetch step three while they're filling out step two? Most of that time is the workspace creation API.",
    },
    {
      id: "seg_0017",
      start: 121.0,
      end: 127.6,
      speaker: "S2",
      text: "Probably yes. I'd want to confirm with backend, but optimistic UI on workspace creation isn't risky — worst case we roll back.",
    },
    {
      id: "seg_0018",
      start: 127.8,
      end: 134.0,
      speaker: "S0",
      text: "Great. Let's write that up as the proposal — visible inference, two-button choice on three, prefetch — and ship to ten percent next week.",
    },
  ],
};

/**
 * Decoration data NOT in the canonical TranscriptPayload but used by the UI
 * (speaker color hints, role badges). Derived from the spec's role/color
 * fields. Kept separate so canonical payload validates against backend
 * Pydantic's extra="forbid".
 */
export const SAMPLE_SPEAKER_DECORATION: Record<string, { role?: string }> = {
  S0: { role: "Design Lead" },
  S1: { role: "PM" },
  S2: { role: "Engineer" },
};
