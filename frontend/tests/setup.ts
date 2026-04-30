// Vitest global setup. Runs once before each test file.
// - jest-dom matchers for RTL assertions (e.g. toBeInTheDocument).
// - HTMLMediaElement polyfill (jsdom 29 does not implement play/pause/load/loadedmetadata).
import "@testing-library/jest-dom/vitest";
import "./__mocks__/audio";
