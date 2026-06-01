import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { propDrillingDetector } from "../../src/detectors/propDrilling.js";
import { runDetector } from "../helpers/runDetector.js";

describe("prop-drilling detector", () => {
  it("flags a component forwarding many props to a child", async () => {
    const src = `
export function Parent({ a, b, c, d, e }: Props) {
  return <Child a={a} b={b} c={c} d={d} e={e} />;
}
`;
    const issues = await runDetector(propDrillingDetector, { "Parent.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "prop-drilling");
    assert.match(issues[0]?.message ?? "", /forwards 5 props/);
  });

  // Guards the known over-counting risk: a component that uses a typed param but
  // forwards only a couple of props to a single child must NOT be flagged.
  it("does NOT flag a component that forwards only a couple props to one child", async () => {
    const src = `
export function Parent({ title, onClose }: Props) {
  return <Child title={title} onClose={onClose} />;
}
`;
    const issues = await runDetector(propDrillingDetector, { "Parent.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag a leaf component that only renders host elements", async () => {
    const src = `
export function Leaf({ title }: Props) {
  return <div>{title}</div>;
}
`;
    const issues = await runDetector(propDrillingDetector, { "Leaf.tsx": src });
    assert.equal(issues.length, 0);
  });

  // React Native primitives are PascalCase but are not user-defined child components.
  // Passing props to View/Text/Pressable/TextInput/icons is composition, not drilling.
  it("does NOT flag a component forwarding only to RN host primitives", async () => {
    const src = `
export function SearchInput({ value, onChangeText, placeholder, textColor, autoFocus, icon }: Props) {
  return (
    <View>
      <MaterialIcons name={icon} color={textColor} />
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} autoFocus={autoFocus} />
    </View>
  );
}
`;
    const issues = await runDetector(propDrillingDetector, { "SearchInput.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("still flags forwarding to a user-defined child even alongside host primitives", async () => {
    const src = `
export function Parent({ a, b, c, d, e }: Props) {
  return (
    <View>
      <Child a={a} b={b} c={c} d={d} e={e} />
    </View>
  );
}
`;
    const issues = await runDetector(propDrillingDetector, { "Parent.tsx": src });
    assert.equal(issues.length, 1);
  });
});
