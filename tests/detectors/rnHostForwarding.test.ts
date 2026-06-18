import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rnHostForwardingDetector } from "../../src/detectors/rnHostForwarding.js";
import { runDetector } from "../helpers/runDetector.js";

describe("rn-host-forwarding detector", () => {
  it("flags a component forwarding many wrapper props into RN host primitives", async () => {
    const src = `
import { Image, Pressable, TextInput, View } from "react-native";

export function SearchCard({
  accessibilityLabel,
  disabled,
  imageStyle,
  onChangeText,
  onPress,
  source,
  style,
  value,
}: Props) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={style}>
      <Image source={source} style={imageStyle} />
      <View style={style}>
        <TextInput onChangeText={onChangeText} value={value} />
      </View>
    </Pressable>
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "SearchCard.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "rn-host-forwarding");
    assert.match(issues[0]?.message ?? "", /forwards 8 wrapper props/);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Pressable")));
  });

  it("flags broad rest-prop spreading into list primitives", async () => {
    const src = `
import { FlatList } from "react-native";

export function FeedList({ data, renderItem, keyExtractor, contentContainerStyle, onEndReached, ...listProps }: Props) {
  return (
    <FlatList
      contentContainerStyle={contentContainerStyle}
      data={data}
      keyExtractor={keyExtractor}
      onEndReached={onEndReached}
      renderItem={renderItem}
      {...listProps}
    />
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "FeedList.tsx": src });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, "high");
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("...listProps")));
  });

  it("does NOT flag a light RN leaf component with a focused host API", async () => {
    const src = `
import { Pressable, Text, View } from "react-native";

export function EmptyState({ title, onRetry, style }: Props) {
  return (
    <View style={style}>
      <Text>{title}</Text>
      <Pressable onPress={onRetry}>
        <Text>Retry</Text>
      </Pressable>
    </View>
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "EmptyState.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag forwarding props to a user-defined child component", async () => {
    const src = `
import { View } from "react-native";

export function Parent({ a, b, c, d, e, f }: Props) {
  return (
    <View>
      <Child a={a} b={b} c={c} d={d} e={e} f={f} />
    </View>
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "Parent.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("does NOT flag web React host forwarding when RN primitives are not imported", async () => {
    const src = `
export function WebCard({ ariaLabel, className, disabled, onClick, role, style, tabIndex }: Props) {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      onClick={onClick}
      role={role}
      style={style}
      tabIndex={tabIndex}
    />
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "WebCard.tsx": src });
    assert.equal(issues.length, 0);
  });

  it("recognizes aliased React Native primitive imports", async () => {
    const src = `
import { View as RNView } from "react-native";

export function Box({ a, b, c, d, e, f }: Props) {
  return <RNView a={a} b={b} c={c} d={d} e={e} f={f} />;
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "Box.tsx": src });
    assert.equal(issues.length, 1);
  });

  it("recognizes Animated.View from React Native named imports", async () => {
    const src = `
import { Animated } from "react-native";

export function MotionBox({ a, b, c, d, e, f }: Props) {
  return <Animated.View a={a} b={b} c={c} d={d} e={e} f={f} />;
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "MotionBox.tsx": src });
    assert.equal(issues.length, 1);
    assert.ok(issues[0]?.evidence?.some((entry) => entry.includes("Animated.View")));
  });

  it("aggregates forwarded props across repeated RN host tags", async () => {
    const src = `
import { View } from "react-native";

export function SplitPanel({ a, b, c, d, e, f }: Props) {
  return (
    <>
      <View a={a} b={b} c={c} />
      <View d={d} e={e} f={f} />
    </>
  );
}
`;
    const issues = await runDetector(rnHostForwardingDetector, { "SplitPanel.tsx": src });
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /forwards 6 wrapper props/);
  });
});
