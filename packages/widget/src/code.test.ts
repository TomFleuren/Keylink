import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeBackup, onlyDigits } from "./code.js";

test("onlyDigits keeps a pasted code", () => {
  assert.equal(onlyDigits("123 456"), "123456");
  assert.equal(onlyDigits("12a3"), "123");
});

test("normalizeBackup strips spaces and dashes", () => {
  assert.equal(normalizeBackup("abcde-fghij"), "ABCDEFGHIJ");
  assert.equal(normalizeBackup("ab cd"), "ABCD");
});
