// jsdom 29 does not implement HTMLMediaElement transport. Stub the methods
// each <audio> test will touch. Keep this minimal — production behaviour is
// verified manually per VALIDATION §Manual-Only Verifications.

export {}; // Make this a module so 'declare global' is valid.

if (typeof window !== "undefined" && typeof HTMLMediaElement !== "undefined") {
  const proto = HTMLMediaElement.prototype as unknown as {
    play: () => Promise<void>;
    pause: () => void;
    load: () => void;
    currentTime: number;
    duration: number;
    playbackRate: number;
  };
  // play / pause / load are no-ops in tests.
  Object.defineProperty(proto, "play", {
    configurable: true,
    value: function play() {
      return Promise.resolve();
    },
  });
  Object.defineProperty(proto, "pause", {
    configurable: true,
    value: function pause() {},
  });
  Object.defineProperty(proto, "load", {
    configurable: true,
    value: function load() {},
  });
}

// URL.createObjectURL / revokeObjectURL — jsdom leaves these undefined too.
if (typeof URL !== "undefined" && typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = (_blob: Blob): string =>
    "blob:mock-" + Math.random().toString(36).slice(2);
  URL.revokeObjectURL = (_url: string): void => {};
}

// Helper for tests that need to fire 'loadedmetadata' with a custom duration.
declare global {
  // eslint-disable-next-line no-var
  var __setMockAudioDuration: (el: HTMLMediaElement, duration: number) => void;
}
(globalThis as typeof globalThis & { __setMockAudioDuration: (el: HTMLMediaElement, duration: number) => void }).__setMockAudioDuration = (
  el: HTMLMediaElement,
  duration: number,
) => {
  Object.defineProperty(el, "duration", { configurable: true, value: duration });
  el.dispatchEvent(new Event("loadedmetadata"));
};
