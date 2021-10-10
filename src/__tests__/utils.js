/* global it, expect */
import { getDuration, prepareWeights } from "../utils.js";

it("Transform threshold", () => {
  const oneDay = 1000 * 60 * 60 * 24;
  expect(getDuration("4y")).toBe(4 * 365 * oneDay);
  expect(getDuration("12m")).toBe(12 * 30 * oneDay);
  expect(getDuration("16w")).toBe(16 * 7 * oneDay);
  expect(getDuration("42d")).toBe(42 * oneDay);
  expect(() => {
    getDuration("36x");
  }).toThrow(/Invalid threshold '36x'./);
  expect(() => {
    getDuration("xxx");
  }).toThrow(/Invalid threshold 'xxx'./);
});

it("Weight", () => {
  const weight = prepareWeights(
    {
      "**/__tests__/*": 0.5,
      "src/business/**": 2,
      "**/*.js": 1.5
    },
    true,
    false
  );

  expect(weight("some/random/file.css")).toBe(1);
  expect(weight("src/business/some/file.js")).toBe(2);
  expect(weight("src/__tests__/utils.js")).toBe(0.5);
  expect(weight("deep/nested/__tests__/utils.js")).toBe(0.5);
  expect(weight("any/javascript.js")).toBe(1.5);
});

it("Weight: Ignore media files", () => {
  const weight = prepareWeights(
    { "**/__tests__/*": 0.5, "**/*.gif": 2 },
    false,
    false
  );

  expect(weight("some/random/file.css")).toBe(1);
  expect(weight("src/business/some/file.js")).toBe(1);
  expect(weight("src/__tests__/utils.js")).toBe(0.5);
  expect(weight("deep/nested/__tests__/utils.js")).toBe(0.5);
  expect(weight("any/file.jpg")).toBe(0);
  expect(weight("any/file.gif")).toBe(2);
  expect(weight("video.mp4")).toBe(0);
});
